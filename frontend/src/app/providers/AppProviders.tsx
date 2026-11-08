import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Toaster } from "sonner";

import { useAuth } from "@/app/store/auth";
import { ApiError } from "@/services/api/client";
import { connectRealtime } from "@/services/realtime";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

function Realtime({ client }: { client: QueryClient }) {
  const token = useAuth((s) => s.accessToken);
  useEffect(() => (token ? connectRealtime(client) : undefined), [token, client]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <Realtime client={client} />
      {children}
      <Toaster position="top-center" richColors closeButton toastOptions={{ style: { borderRadius: 16 } }} />
    </QueryClientProvider>
  );
}
