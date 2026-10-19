import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout';
import { useTheme } from '@/components/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FloorPage } from '@/pages/floor';
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
            <Route path="cadastros" element={<RegistryPage />} />
            <Route path="*" element={<FloorPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster theme={theme} richColors closeButton position="top-center" />
    </TooltipProvider>
  );
}
