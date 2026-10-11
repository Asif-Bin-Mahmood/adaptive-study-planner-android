import { createContext, useContext, useEffect, useState, type DependencyList } from 'react';
import type { Repo } from '../data/repo';
import type { ISODate, Term } from '../domain/types';

export interface Toast {
  text: string;
  kind?: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface AppCtx {
  repo: Repo;
  term: Term;
  today: ISODate;
  toast: (t: Toast | string) => void;
  /** Report a failed operation to the user without losing the screen. */
  fail: (e: unknown) => void;
  openSettings: () => void;
  openReplan: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('No app context');
  return c;
}

/** Load data from the repository and reload automatically after any write. */
export function useData<T>(load: () => Promise<T>, deps: DependencyList): { data: T | undefined; error: unknown } {
  const { repo } = useApp();
  const [version, setVersion] = useState(repo.version);
  const [state, setState] = useState<{ data: T | undefined; error: unknown }>({ data: undefined, error: null });
  useEffect(() => repo.onChange(() => setVersion(repo.version)) as () => void, [repo]);
  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ data, error: null }),
      (error) => alive && setState((s) => ({ data: s.data, error })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}
