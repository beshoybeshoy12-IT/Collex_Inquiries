import { useTranslation } from 'react-i18next';
import AttendanceCard from './AttendanceCard';
import AnnouncementsPanel from './AnnouncementsPanel';
import TeamAttendance from './TeamAttendance';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';

/** The home page: today's attendance and the company announcements. */
export default function Home() {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <>
      <h1 className="h3 fw-bold mb-4">{t('home.title')}</h1>
      <div className="row g-3">
        <div className="col-12 col-lg-5">
          <AttendanceCard />
        </div>
        <div className="col-12 col-lg-7">
          <AnnouncementsPanel />
        </div>
      </div>
      {can(P.ATTENDANCE_VIEW_ALL) && <TeamAttendance />}
    </>
  );
}
