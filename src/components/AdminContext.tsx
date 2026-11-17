"use client";

import { createContext, useContext } from "react";

// One provider, created in DashboardTable: admin controls sit in six tabs and
// threading a prop through every layer would touch ~15 files.
const AdminContext = createContext(false);

export const AdminProvider = AdminContext.Provider;

export function useIsAdmin(): boolean {
  return useContext(AdminContext);
}
