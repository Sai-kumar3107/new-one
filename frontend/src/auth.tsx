import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, getToken, setToken, setUnauthorizedHandler } from "@/src/api";
import { queryClient } from "@/src/query-client";

export type Role = "global_admin" | "org_admin" | "finance" | "sales_exec" | "channel_partner";
export type User = { id: string; email: string; name: string; role: Role; org_id?: string | null; phone?: string };
export type Org = { id: string; name: string; code: string; status: string; plan?: string; seats?: number; renewal_date?: string };

type Ctx = {
  user: User | null;
  org: Org | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  partnerSignup: (body: Record<string, string>) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    await setToken(null);
    queryClient.clear();
    setUser(null);
    setOrg(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
    (async () => {
      const t = await getToken();
      if (t) {
        try {
          const me = await api<{ user: User; org: Org | null }>("/auth/me");
          setUser(me.user);
          setOrg(me.org);
        } catch {
          await setToken(null);
        }
      }
      setLoading(false);
    })();
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const apply = async (res: { token: string; user: User; org: Org | null }) => {
    await setToken(res.token);
    queryClient.clear();
    setUser(res.user);
    setOrg(res.org);
    return res.user;
  };

  const login = async (email: string, password: string) =>
    apply(await api("/auth/login", { body: { email: email.trim(), password } }));

  const partnerSignup = async (body: Record<string, string>) => apply(await api("/auth/partner-signup", { body }));

  return <AuthCtx.Provider value={{ user, org, loading, login, partnerSignup, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export const canEditLeads = (r?: Role) => r === "org_admin" || r === "sales_exec";
export const isAdminish = (r?: Role) => r === "org_admin" || r === "finance";
