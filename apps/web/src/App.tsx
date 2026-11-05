import {VisitorsPage} from './pages/VisitorsPage';
import { useState } from 'react';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { PostsPage } from './pages/PostsPage';
import { GroupsPage } from './pages/GroupsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReferralDirectoryPage } from './pages/ReferralDirectoryPage';
import { AiQueuePage } from './pages/AiQueuePage';
import { AiUsagePage } from './pages/AiUsagePage';

export default function App() {
  const [page, setPage] = useState('Posts');
  const body = page === 'Visitor Opportunities' ? <VisitorsPage /> : page === 'Posts'
    ? <PostsPage />
    : page === 'Groups'
      ? <GroupsPage />
      : page === 'Referral Queue'
        ? <AiQueuePage />
        : page === 'AI Usage'
          ? <AiUsagePage />
          : page === 'Settings'
            ? <SettingsPage />
            : page === 'Referral Directory'
              ? <ReferralDirectoryPage />
              : <DashboardPage />;
  return <Layout page={page} setPage={setPage}>{body}</Layout>;
}
