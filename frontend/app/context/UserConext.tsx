import { createContext, useContext, useMemo, useState } from "react";

export type User = {
  netid: string;
  roles: string[];
  display_name?: string;
};

type UserContextValue = {
  user: User | null;
  setUser: (user: User | null) => void;
  hasRole: (role: string) => boolean;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const hasRole = (role: string) => {
    if (!user) return false;
    return user.roles.includes(role);
  };
  const value = useMemo(() => ({ user, setUser, hasRole }), [user]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
