import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout';
import { useTheme } from '@/components/theme';
import { TooltipProvider } from '@/components/ui/tooltip';

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

export function App() {
  const { theme } = useTheme();
  return (
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            {/* Fora do layout: cardápio do cliente e folha de QR para imprimir. */}
            <Route path="cardapio" element={<PublicMenuPage />} />
            <Route path="qrcode" element={<QrCodesPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<FloorPage />} />
              <Route path="comandas" element={<TabsPage />} />
              <Route path="caixa" element={<CashPage />} />
              <Route path="painel" element={<DashboardPage />} />
              <Route path="comandas/:id" element={<TabDetailPage />} />
              <Route path="comandas/:id/fechar" element={<CloseTabPage />} />
              <Route path="produtos" element={<ProductsPage />} />
              <Route path="produtos/novo" element={<AddItemPage />} />
              <Route path="comecar" element={<OnboardingPage />} />
              <Route path="produtos/montar" element={<BurgerBuilderPage />} />
              <Route path="produtos/pizzaria" element={<PizzeriaPage />} />
              <Route
                path="produtos/:id/montar"
                element={<BurgerBuilderPage />}
              />
              <Route path="cadastros" element={<RegistryPage />} />
              <Route path="conectar" element={<ConnectPage />} />
              <Route path="*" element={<FloorPage />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster theme={theme} richColors closeButton position="top-center" />
    </TooltipProvider>
  );
}
