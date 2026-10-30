import {
  type CurrentUser,
  hasRole,
  type Session,
  type UserRole,
} from '@muquifo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  api,
  getAuthToken,
  onAuthTokenChange,
  queryKeys,
  setAuthToken,
} from '@/api';

interface AuthContextValue {
  /** Quem está logado neste aparelho (nulo = mostrar a entrada). */
  user: CurrentUser | null;
  /** Conferindo a sessão guardada (evita piscar a tela de entrada). */
  checking: boolean;
  signIn: (session: Session) => void;
  /** Sai deste aparelho (ou troca de usuário). */
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(getAuthToken);
  useEffect(() => onAuthTokenChange(setToken), []);

  const me = useQuery({
    queryKey: [...queryKeys.me, token],
    queryFn: api.me,
    enabled: token !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Sem sessão: nada do usuário anterior fica em cache (painel, caixa...).
  useEffect(() => {
    if (token === null)
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== queryKeys.authStatus[0],
      });
  }, [token, queryClient]);

  const signIn = useCallback(
    (session: Session) => {
      queryClient.clear();
      queryClient.setQueryData([...queryKeys.me, session.token], session.user);
      setAuthToken(session.token);
    },
    [queryClient],
  );

  const signOut = useCallback(() => {
    void api.logout().catch(() => undefined);
    setAuthToken(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.authStatus });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: token ? (me.data ?? null) : null,
      checking: token !== null && me.isPending,
      signIn,
      signOut,
    }),
    [token, me.data, me.isPending, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth fora do AuthProvider');
  return value;
}

/** A função do usuário logado alcança a mínima pedida? */
export function useCan(minimum: UserRole): boolean {
  const { user } = useAuth();
  return user !== null && hasRole(user.role, minimum);
}
