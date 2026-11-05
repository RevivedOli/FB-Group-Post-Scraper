import { Alert, Stack, Typography } from '@mui/material';
import { CollectorWorkerPanel } from '../components/CollectorWorkerPanel';
import { RecurringStatus } from '../components/RecurringStatus';
import { CollectorStatus } from '../components/CollectorStatus';
export function DashboardPage() {
  return <Stack spacing={3}>
    <Typography variant="h4">Dashboard</Typography>
    <Alert severity="info">This dashboard runs the current Python collector. Your existing Groups list is the collection list. Older browser-scraper history is preserved in the database.</Alert>
    <RecurringStatus />
    <CollectorWorkerPanel />
    <CollectorStatus onSync={()=>{}} />
  </Stack>;
}
