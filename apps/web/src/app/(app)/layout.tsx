import { AppShell } from '@/components/app-shell';

// Toutes les routes de ce groupe partagent la coquille authentifiee.
// /login vit hors du groupe : il ne doit pas afficher la barre laterale.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
