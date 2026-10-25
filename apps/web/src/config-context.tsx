import { createContext, useContext, type ReactNode } from "react";
import type { AppConfigDto } from "@reprolab/shared";
import { api } from "./api";
import { useResource } from "./hooks";

interface ConfigValue {
  config: AppConfigDto | null;
  error: Error | null;
}

const ConfigContext = createContext<ConfigValue>({ config: null, error: null });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data, error } = useResource(api.config, []);
  return <ConfigContext.Provider value={{ config: data, error }}>{children}</ConfigContext.Provider>;
}

export function useAppConfig(): ConfigValue {
  return useContext(ConfigContext);
}
