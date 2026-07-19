import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Hachage des mots de passe avec Argon2id.
 *
 * On utilise @node-rs/argon2 (binaires precompiles) plutot que le paquet
 * `argon2` natif : ce dernier exige une chaine de compilation C++ que les
 * postes Windows n'ont generalement pas.
 *
 * Parametres alignes sur les recommandations OWASP 2024 pour Argon2id :
 * 19 Mio de memoire, 2 iterations, parallelisme 1.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  /**
   * Hash factice servant a egaliser le temps de reponse quand l'email
   * n'existe pas : sans cela, l'ecart de latence entre "compte inconnu" et
   * "mot de passe faux" permet d'enumerer les comptes valides.
   *
   * Genere au demarrage plutot qu'ecrit en dur : un litteral doit rester un
   * encodage Argon2 valide pour que `verify` fasse reellement le calcul au
   * lieu d'echouer immediatement au parsing — ce qui reintroduirait
   * exactement l'ecart de temps qu'on cherche a supprimer.
   */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(32).toString('hex'), OPTIONS);
  }

  async hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, OPTIONS);
    } catch {
      // Hash corrompu ou format inconnu : on refuse plutot que de propager.
      return false;
    }
  }

  /**
   * Consomme le meme temps CPU qu'une verification reelle.
   * A appeler quand l'utilisateur est introuvable ou n'a pas de mot de passe.
   */
  async wasteTime(plain: string): Promise<void> {
    if (!this.dummyHash) return;
    try {
      await verify(this.dummyHash, plain, OPTIONS);
    } catch {
      // Attendu : le hash factice ne correspond jamais.
    }
  }
}
