import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout';
import { useTheme } from '@/components/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AddItemPage } from '@/pages/add-item';
import { BurgerBuilderPage } from '@/pages/burger-builder';
import { CloseTabPage } from '@/pages/close-tab';
import { FloorPage } from '@/pages/floor';
import { OnboardingPage } from '@/pages/onboarding';
import { PizzeriaPage } from '@/pages/pizzeria';
import { ProductsPage } from '@/pages/products';
import { RegistryPage } from '@/pages/registry';
import { TabDetailPage } from '@/pages/tab-detail';
import { TabsPage } from '@/pages/tabs';

export function App() {
  const { theme } = useTheme();
  return (
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<FloorPage />} />
            <Route path="comandas" element={<TabsPage />} />
            <Route path="comandas/:id" element={<TabDetailPage />} />
            <Route path="comandas/:id/fechar" element={<CloseTabPage />} />
            <Route path="produtos" element={<ProductsPage />} />
            <Route path="produtos/novo" element={<AddItemPage />} />
            <Route path="comecar" element={<OnboardingPage />} />
            <Route path="produtos/montar" element={<BurgerBuilderPage />} />
            <Route path="produtos/pizzaria" element={<PizzeriaPage />} />
            <Route path="produtos/:id/montar" element={<BurgerBuilderPage />} />
            <Route path="cadastros" element={<RegistryPage />} />
            <Route path="*" element={<FloorPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster theme={theme} richColors closeButton position="top-center" />
    </TooltipProvider>
  );
}
