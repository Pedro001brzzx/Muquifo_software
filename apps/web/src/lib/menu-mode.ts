import { useCallback, useState } from 'react';

export type MenuMode = 'simple' | 'complete';

const STORAGE_KEY = 'muquifo.menu-mode';

function read(): MenuMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'complete'
      ? 'complete'
      : 'simple';
  } catch {
    return 'simple';
  }
}

/**
 * Modo da tela de cardápio neste aparelho. Simples (padrão): cartões com
 * figura e o assistente. Completo: categorias, complementos e montadores.
 */
export function useMenuMode() {
  const [mode, setModeState] = useState<MenuMode>(read);
  const setMode = useCallback((next: MenuMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem armazenamento: vale só nesta visita.
    }
  }, []);
  return [mode, setMode] as const;
}
