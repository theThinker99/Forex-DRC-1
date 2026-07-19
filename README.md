# Change RDC — Plateforme de change manuel

Application web de gestion des opérations de change manuel pour la République
Démocratique du Congo, avec **contrôle BCC en lecture seule**, RBAC strict,
journal d'audit complet et génération de bordereaux PDF.

---

## 1. Architecture

Monorepo npm workspaces :

```
change-rdc/
├── apps/
│   ├── api/            API REST — NestJS 10 + Prisma + PostgreSQL
│   │   ├── prisma/
│   │   │   ├── schema.prisma     Schéma de la base (10 modèles + enums)
│   │   │   └── seed.ts           Données de démonstration
│   │   └── src/
│   │       ├── auth/             Authentification locale + Google, JWT rotatif
│   │       ├── users/ agencies/ clients/ exchange-rates/
│   │       ├── transactions/     Cœur métier : saisie, validation, export
│   │       ├── receipts/         Génération PDF des bordereaux (pdfkit)
│   │       ├── attachments/      Upload sécurisé des pièces d'identité
│   │       ├── alerts/           Moteur d'alertes AML (seuils, fractionnement)
│   │       ├── stats/            Tableaux de bord agrégés
│   │       ├── settings/         Paramètres système (seuils, politiques)
│   │       ├── audit/            Journal d'audit append-only
│   │       └── common/           Guards RBAC, décorateurs, pagination, argent
│   └── web/            Frontend — Next.js 15 (App Router) + React 19
│       └── src/
│           ├── app/(app)/        Pages authentifiées par rôle
│           ├── app/login/        Écran de connexion (e-mail + Google)
│           ├── components/       Coquille applicative, composants UI
│           └── lib/              Client HTTP, contexte d'auth, formatage
├── docker-compose.yml            PostgreSQL 16 (+ MinIO optionnel)
└── .env.example                  Variables d'environnement documentées
```

**Choix techniques**

| Besoin | Choix | Pourquoi |
|---|---|---|
| Backend | NestJS | Guards/décorateurs adaptés à un RBAC strict |
| ORM | Prisma | Migrations typées, `Decimal` natif pour la monnaie |
| Auth | JWT access (mémoire) + refresh rotatif (cookie httpOnly) | Résiste au XSS ; révocation immédiate |
| Mots de passe | Argon2id (`@node-rs/argon2`) | Binaire précompilé — pas de compilation C++ sous Windows |
| PDF | pdfkit | Pas de Chromium à télécharger ; sortie déterministe |
| Frontend | Next.js 15 | SSR/App Router, proxy API intégré |

---

## 2. Modèle de données

10 tables métier + 2 tables d'infrastructure. Toutes les valeurs monétaires
sont en `Decimal` (jamais de `float`).

| Table | Rôle |
|---|---|
| `agencies` | Bureaux de change (multi-agences dès le départ) |
| `users` | Comptes + rôle (source de vérité de l'autorisation) |
| `refresh_tokens` | Sessions rotatives (hash SHA-256, détection de rejeu) |
| `clients` | Fiches KYC, pièce d'identité unique |
| `exchange_rates` | Taux append-only (historique conservé) |
| `transactions` | Opérations de change + contre-valeur USD |
| `receipts` | Bordereaux (numéro unique, checksum, compteur d'impressions) |
| `attachments` | Pièces jointes (clé opaque, hors URL publique) |
| `alerts` | Signalements AML (seuils, fractionnement, taux hors bande) |
| `audit_logs` | Journal append-only de toutes les actions sensibles |
| `document_sequences` | Numérotation atomique des références/bordereaux |
| `system_settings` | Paramètres modifiables sans redéploiement |

Le schéma complet et commenté est dans
[`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).

### Rôles et permissions

| Capacité | ADMIN | BCC | SUPERVISEUR | CABISTE |
|---|:---:|:---:|:---:|:---:|
| Voir toutes les opérations | ✅ | ✅ (lecture seule) | Son agence | Les siennes |
| Créer client / opération | ✅ | ❌ | ✅ | ✅ |
| Valider / rejeter une opération | ✅ | ❌ | ✅ (pas la sienne) | ❌ |
| Imprimer un bordereau | ✅ | ❌ | ✅ | Les siens |
| Gérer taux / agences / utilisateurs | ✅ | ❌ | ❌ | ❌ |
| Paramètres système | ✅ | ❌ | ❌ | ❌ |
| Journal d'audit | ✅ | ❌ | ❌ | ❌ |
| Alertes | ✅ | ✅ (lecture) | ✅ | ❌ |

Le mandat **lecture seule de la BCC** est garanti par un `ReadOnlyGuard` global
qui refuse toute méthode non-`GET` à ce rôle, indépendamment des `@Roles` de
chaque route : un oubli de déclaration reste sans danger.

---

## 3. Prérequis

- **Node.js ≥ 20.11**
- **PostgreSQL 16** (ou Docker)
- npm ≥ 10

> ⚠️ Cette machine n'a ni Node ni PostgreSQL installés au moment de la
> livraison : suivez l'installation ci-dessous avant le premier lancement.

---

## 4. Installation locale — pas à pas

### 4.1 Base de données

**Option A — Docker (recommandé)**

```bash
docker compose up -d postgres
```

**Option B — PostgreSQL déjà installé** : créez la base et l'utilisateur

```sql
CREATE USER change_rdc WITH PASSWORD 'change_rdc_dev';
CREATE DATABASE change_rdc OWNER change_rdc;
```

### 4.2 Variables d'environnement

```bash
cp .env.example .env
```

Puis, à la racine, générez deux secrets JWT **distincts** :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Reportez-les dans `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET`. L'API refuse de
démarrer avec les valeurs d'exemple.

### 4.3 Dépendances

```bash
npm install
```

### 4.4 Schéma + données de démonstration

```bash
npm run db:generate     # génère le client Prisma
npm run db:migrate      # crée les tables (migration initiale)
npm run db:seed         # agences, 4 rôles, clients, taux, opérations
```

### 4.5 Lancement

```bash
npm run dev             # API (port 4000) + Web (port 3000) en parallèle
```

- Frontend : <http://localhost:3000>
- API : <http://localhost:4000/api>
- Documentation Swagger : <http://localhost:4000/api/docs>

### 4.6 Comptes de démonstration

Mot de passe commun : **`ChangeRDC2026!`**

| Rôle | E-mail |
|---|---|
| Administrateur | `admin@change-rdc.cd` |
| Contrôle BCC (lecture seule) | `bcc@change-rdc.cd` |
| Superviseur (Goma) | `superviseur.goma@change-rdc.cd` |
| Cabiste (Goma) | `cabiste.goma@change-rdc.cd` |
| Cabiste (Kinshasa) | `cabiste.kinshasa@change-rdc.cd` |

> Comptes de développement uniquement. À supprimer avant toute mise en production.

---

## 5. Connexion Google (optionnelle)

Le bouton « Continuer avec Google » ne s'affiche que si le serveur est configuré.

1. Console Google Cloud → **API et services** → **Identifiants** → créez un
   **ID client OAuth 2.0** (type *Application Web*).
2. Origines JavaScript autorisées : `http://localhost:3000`.
3. Renseignez `GOOGLE_CLIENT_ID` dans `.env`, puis redémarrez l'API.

**Principe** : Google prouve l'identité, **jamais les droits**. Le rôle est
toujours lu en base. Un compte auto-créé via Google naît *suspendu* et doit
être activé par un administrateur (auto-provisionnement désactivé par défaut).

---

## 6. API REST — aperçu

Toutes les routes sont préfixées par `/api`. Authentification par
`Authorization: Bearer <accessToken>`. Le refresh token circule en cookie
httpOnly. Référence interactive complète : `/api/docs`.

| Domaine | Endpoints principaux |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/google`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `POST /auth/link-google` |
| Utilisateurs | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `DELETE /users/:id` |
| Agences | `GET/POST /agencies`, `PATCH /agencies/:id`, `DELETE /agencies/:id` |
| Clients | `GET/POST /clients`, `GET /clients/by-document`, `PATCH /clients/:id`, `PATCH /clients/:id/identity` |
| Taux | `GET /exchange-rates/board`, `GET /exchange-rates`, `POST /exchange-rates` |
| Opérations | `GET/POST /transactions`, `GET /transactions/:id`, `GET /transactions/export`, `PATCH /transactions/:id/{validate,reject,cancel}` |
| Bordereaux | `GET /transactions/:id/receipt`, `POST /transactions/:id/receipt/pdf` |
| Pièces jointes | `POST /attachments`, `GET /attachments/:id/content`, `DELETE /attachments/:id` |
| Alertes | `GET /alerts`, `GET /alerts/count`, `PATCH /alerts/:id/resolve` |
| Statistiques | `GET /stats/dashboard`, `GET /stats/timeseries`, `GET /stats/top-operators` |
| Paramètres | `GET /settings`, `PUT /settings/:key` |
| Audit | `GET /audit-logs`, `GET /audit-logs/actions` |
| Santé | `GET /health` |

**Pagination** : `?page=1&limit=25` (limite plafonnée à 100). Réponse :
`{ data: [...], meta: { page, limit, total, totalPages, hasNext, hasPrevious } }`.

---

## 7. Sécurité — points clés

- **Argon2id** pour les mots de passe ; comparaison à temps constant et anti-énumération de comptes.
- **Access token en mémoire** (jamais localStorage) + **refresh token httpOnly** rotatif avec détection de rejeu (révocation de toute la chaîne).
- **RBAC en profondeur** : `JwtAuthGuard` → `ReadOnlyGuard` → `RolesGuard`, tous globaux. Le rôle est relu en base à chaque requête (révocation immédiate).
- **Cloisonnement par agence** appliqué côté serveur, jamais seulement dans l'UI.
- **Uploads** : type réel vérifié par signature binaire, taille limitée, clé de stockage opaque, accès uniquement via route authentifiée et journalisée.
- **Audit append-only** : aucun service n'expose de mise à jour ou de suppression du journal ; secrets expurgés automatiquement.
- **Séparation des tâches** : un superviseur ne peut pas valider sa propre saisie ; le dernier administrateur ne peut pas se retirer ses droits.

---

## 8. Production — check-list

1. `NODE_ENV=production`, `COOKIE_SECURE=true` (HTTPS obligatoire).
2. Secrets JWT longs, aléatoires et distincts, stockés hors du dépôt.
3. `npm run build`, puis `npm run db:deploy` (migrations sans reset) et
   `npm run start:prod` côté API.
4. Stockage : `STORAGE_DRIVER=s3` avec un bucket privé (MinIO/Scaleway/…).
5. Restreindre `CORS_ORIGINS` au domaine réel du frontend.
6. Supprimer les comptes de démonstration.
7. Purger périodiquement les refresh tokens expirés (`TokensService.purgeExpired`).

---

## 9. Scripts utiles (racine)

| Commande | Effet |
|---|---|
| `npm run dev` | API + Web en développement |
| `npm run build` | Build de production des deux applications |
| `npm run db:migrate` | Applique une nouvelle migration |
| `npm run db:seed` | (Ré)injecte les données de démonstration |
| `npm run db:reset` | Réinitialise la base (⚠️ efface tout) puis reseed |
| `npm run db:studio` | Ouvre Prisma Studio (exploration de la base) |
