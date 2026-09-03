'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthOrg {
  id: string;
  name: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  org: AuthOrg | null;
  token: string | null;
}

/**
 * Auth hook — read tokens from localStorage and listen for changes.
 * Use this to gate UI elements and call /api/v1 endpoints.
 */
export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ user: null, org: null, token: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => {
      const token = localStorage.getItem('accessToken');
      const userRaw = localStorage.getItem('user');
      const orgRaw = localStorage.getItem('organization');
      setState({
        token,
        user: userRaw ? JSON.parse(userRaw) : null,
        org: orgRaw ? JSON.parse(orgRaw) : null,
      });
      setReady(true);
    };
    update();
    window.addEventListener('storage', update);
    window.addEventListener('aibos:auth:changed', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('aibos:auth:changed', update);
    };
  }, []);

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('organization');
    window.dispatchEvent(new Event('aibos:auth:changed'));
    router.push('/login');
  };

  return { ...state, ready, logout };
}

/** Convenience: require auth and redirect if not. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (auth.ready && !auth.token) router.push('/login');
  }, [auth.ready, auth.token, router]);
  return auth;
}
