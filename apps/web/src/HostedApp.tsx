'use client';

import { useState } from 'react';
import { HostedProviderPanel } from './components/HostedProviderPanel';
import { HostedI18nProvider } from './i18n/hosted';
import { HostedProviderClient } from './providers/hosted';
import styles from './HostedApp.module.css';

export function HostedApp() {
  const [client] = useState(() => new HostedProviderClient());
  return (
    <main className={styles.main}>
      <HostedI18nProvider>
        <HostedProviderPanel client={client} />
      </HostedI18nProvider>
    </main>
  );
}
