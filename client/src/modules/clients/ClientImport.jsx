import { useParams } from 'react-router-dom';
import ErrorState from '../../components/ErrorState';
import { useClient } from '../../hooks/useClients';
import ImportWizard from '../imports/ImportWizard';

/** The import wizard inside one client: its template is the mapping. */
export default function ClientImport() {
  const { id } = useParams();
  const { data: client, isLoading, error, refetch } = useClient(id);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !client) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-12 d-block" style={{ height: 240 }} />
      </div>
    );
  }
  return <ImportWizard key={client.id} client={client} />;
}
