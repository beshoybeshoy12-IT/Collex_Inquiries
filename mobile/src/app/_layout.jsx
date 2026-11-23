import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { loadLanguage } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { Loading } from '../components/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone in the field drops in and out of coverage; one retry covers
      // a blip without spinning on a dead connection.
      retry: 1,
      staleTime: 30_000,
    },
  },
});

/**
 * The root: providers, then one stack with two protected halves. Signed out,
 * only `login` exists; signed in, only the app. Expo Router redirects
 * between them when the guard flips (SDK 58 `Stack.Protected`).
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { investigator, ready } = useAuth();
  const colors = useColors();
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    loadLanguage().finally(() => setLanguageReady(true));
  }, []);

  if (!ready || !languageReady) return <Loading />;

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.page },
        }}
      >
        <Stack.Protected guard={Boolean(investigator)}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!investigator}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
