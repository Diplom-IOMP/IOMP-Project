import { useEffect, useState } from 'react';
import type { Schemas } from '@iomp/api-types';

// Placeholder screen until the first UI issue; shows that the API is reachable
// and that contract types resolve in the web app.
type Severity = Schemas['Severity'];
const severities: Severity[] = ['Critical', 'High', 'Medium', 'Low', 'Info', 'Unknown'];

export function App() {
  const [api, setApi] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    fetch('/livez')
      .then((res) => setApi(res.ok ? 'up' : 'down'))
      .catch(() => setApi('down'));
  }, []);

  return (
    <main>
      <h1>IOMP</h1>
      <p>API: {api}</p>
      <p>Severities: {severities.join(', ')}</p>
    </main>
  );
}
