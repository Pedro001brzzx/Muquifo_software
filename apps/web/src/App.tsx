import { type UserRole, userRoleLabel } from '@muquifo/contracts';
import { Lock } from 'lucide-react';
import { lazy, type ReactNode, Suspense } from 'react';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { ApprovalDialog } from '@/components/approval-dialog';
import { AppLayout } from '@/components/layout';
import { useTheme } from '@/components/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth, useCan } from '@/lib/auth';

/**
 * Cada tela vira um arquivo separado: o celular do cliente baixa só o
 * cardápio, não o sistema inteiro.
 */
const page = <K extends string>(
  load: () => Promise<Record<K, React.ComponentType>>,
  name: K,
) => lazy(() => load().then((m) => ({ default: m[name] })));

const AddItemPage = page(() => import('@/pages/add-item'), 'AddItemPage');
const BurgerBuilderPage = page(
  () => import('@/pages/burger-builder'),
  'BurgerBuilderPage',
);
const CashPage = page(() => import('@/pages/cash'), 'CashPage');
const CloseTabPage = page(() => import('@/pages/close-tab'), 'CloseTabPage');
const ConnectPage = page(() => import('@/pages/connect'), 'ConnectPage');
const DashboardPage = page(() => import('@/pages/dashboard'), 'DashboardPage');
const FloorPage = page(() => import('@/pages/floor'), 'FloorPage');
const OnboardingPage = page(
  () => import('@/pages/onboarding'),
  'OnboardingPage',
);
const PizzeriaPage = page(() => import('@/pages/pizzeria'), 'PizzeriaPage');
const ProductsPage = page(() => import('@/pages/products'), 'ProductsPage');
const PublicMenuPage = page(
  () => import('@/pages/public-menu'),
  'PublicMenuPage',
);
const QrCodesPage = page(() => import('@/pages/qr-codes'), 'QrCodesPage');
const RegistryPage = page(() => import('@/pages/registry'), 'RegistryPage');
const TabDetailPage = page(() => import('@/pages/tab-detail'), 'TabDetailPage');
const TabsPage = page(() => import('@/pages/tabs'), 'TabsPage');
const LoginScreen = page(() => import('@/pages/login'), 'LoginScreen');

/** Tela só para quem tem a função mínima; os outros veem um aviso. */
function Only({ min, children }: { min: UserRole; children: ReactNode }) {
  const allowed = useCan(min);
  if (allowed) return children;
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
      <Lock className="size-10 text-muted-foreground" />
      <p className="text-lg font-semibold">
        Esta tela é para {userRoleLabel[min].toLowerCase()}.
      </p>
      <p className="text-muted-foreground">
        Peça para quem tem acesso, ou troque de usuário no menu.
      </p>
    </div>
  );
}

/** Sem sessão neste aparelho: tela de entrada com PIN. */
function RequireLogin() {
  const { user, checking } = useAuth();
  if (checking) return null;
  if (!user) return <LoginScreen />;
  return <Outlet />;
}

export function App() {
  const { theme } = useTheme();
  return (
    <TooltipProvider delayDuration={300}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={null}>
            <Routes>
              {/* Cardápio do cliente (QR code): sem login. */}
              <Route path="cardapio" element={<PublicMenuPage />} />
              <Route element={<RequireLogin />}>
                {/* Fora do layout: folha de QR para imprimir. */}
                <Route
                  path="qrcode"
                  element={
                    <Only min="owner">
                      <QrCodesPage />
                    </Only>
                  }
                />
                <Route element={<AppLayout />}>
                  <Route index element={<FloorPage />} />
                  <Route path="comandas" element={<TabsPage />} />
                  <Route path="comandas/:id" element={<TabDetailPage />} />
                  <Route
                    path="comandas/:id/fechar"
                    element={
                      <Only min="cashier">
                        <CloseTabPage />
                      </Only>
                    }
                  />
                  <Route
                    path="caixa"
                    element={
                      <Only min="cashier">
                        <CashPage />
                      </Only>
                    }
                  />
                  {ownerRoutes.map(([path, element]) => (
                    <Route
                      key={path}
                      path={path}
                      element={<Only min="owner">{element}</Only>}
                    />
                  ))}
                  <Route path="*" element={<FloorPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
        <ApprovalDialog />
      </AuthProvider>
      <Toaster theme={theme} richColors closeButton position="top-center" />
    </TooltipProvider>
  );
}

/** Administração: painel, cardápio, cadastros e celulares. */
const ownerRoutes: [string, ReactNode][] = [
  ['painel', <DashboardPage key="painel" />],
  ['produtos', <ProductsPage key="produtos" />],
  ['produtos/novo', <AddItemPage key="novo" />],
  ['comecar', <OnboardingPage key="comecar" />],
  ['produtos/montar', <BurgerBuilderPage key="montar" />],
  ['produtos/pizzaria', <PizzeriaPage key="pizzaria" />],
  ['produtos/:id/montar', <BurgerBuilderPage key="montar-id" />],
  ['cadastros', <RegistryPage key="cadastros" />],
  ['conectar', <ConnectPage key="conectar" />],
];
