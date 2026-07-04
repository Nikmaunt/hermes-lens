import { lazy, Suspense } from 'react'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router'
import { AuthBanner } from './components/AuthBanner'
import { BottomNav } from './components/BottomNav'
import { SnackbarProvider } from './components/SnackbarProvider'
import { ListSkeleton } from './components/primitives'
import { DataSourceProvider } from './data/DataSourceProvider'
import { SettingsProvider, useSettings } from './settings/SettingsProvider'
import { FirstRunScreen } from './features/onboarding/FirstRunScreen'
import { LockGate } from './features/lock/LockGate'
// Core tabs stay in the main chunk for an instant first paint.
import { TodayScreen } from './features/today/TodayScreen'
import { TimelineScreen } from './features/timeline/TimelineScreen'
import { CaptureScreen } from './features/capture/CaptureScreen'
import { MemoryScreen } from './features/memory/MemoryScreen'
import { MoreScreen } from './features/more/MoreScreen'

// Secondary screens load on demand (code-split per route).
const MemoryMapScreen = lazy(() =>
  import('./features/memory-map/MemoryMapScreen').then((m) => ({ default: m.MemoryMapScreen })),
)
const InboxScreen = lazy(() =>
  import('./features/inbox/InboxScreen').then((m) => ({ default: m.InboxScreen })),
)
const ProjectsScreen = lazy(() =>
  import('./features/projects/ProjectsScreen').then((m) => ({ default: m.ProjectsScreen })),
)
const PeopleScreen = lazy(() =>
  import('./features/people/PeopleScreen').then((m) => ({ default: m.PeopleScreen })),
)
const DocumentsScreen = lazy(() =>
  import('./features/documents/DocumentsScreen').then((m) => ({ default: m.DocumentsScreen })),
)
const DecisionsScreen = lazy(() =>
  import('./features/decisions/DecisionsScreen').then((m) => ({ default: m.DecisionsScreen })),
)
const HabitsScreen = lazy(() =>
  import('./features/habits/HabitsScreen').then((m) => ({ default: m.HabitsScreen })),
)
const PolishScreen = lazy(() =>
  import('./features/polish/PolishScreen').then((m) => ({ default: m.PolishScreen })),
)
const SearchScreen = lazy(() =>
  import('./features/search/SearchScreen').then((m) => ({ default: m.SearchScreen })),
)
const StatusScreen = lazy(() =>
  import('./features/status/StatusScreen').then((m) => ({ default: m.StatusScreen })),
)
const SettingsScreen = lazy(() =>
  import('./features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
)

function Shell() {
  return (
    <div className="min-h-full pb-20">
      <Suspense fallback={<div className="p-4 pt-16"><ListSkeleton rows={4} /></div>}>
        <Outlet />
      </Suspense>
      <AuthBanner />
      <BottomNav />
    </div>
  )
}

function Root() {
  const { ready, settings } = useSettings()
  if (!ready) return null // one-frame gate while Preferences load
  // No data source chosen yet: demo data must never be silently active (F1).
  if (!settings.configured) return <FirstRunScreen />
  return (
    <DataSourceProvider>
      <LockGate>
        <SnackbarProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<TodayScreen />} />
                <Route path="/timeline" element={<TimelineScreen />} />
                <Route path="/memory" element={<MemoryScreen />} />
                <Route path="/memory/map" element={<MemoryMapScreen />} />
                <Route path="/capture" element={<CaptureScreen />} />
                <Route path="/inbox" element={<InboxScreen />} />
                <Route path="/projects" element={<ProjectsScreen />} />
                <Route path="/people" element={<PeopleScreen />} />
                <Route path="/documents" element={<DocumentsScreen />} />
                <Route path="/decisions" element={<DecisionsScreen />} />
                <Route path="/habits" element={<HabitsScreen />} />
                <Route path="/polish" element={<PolishScreen />} />
                <Route path="/search" element={<SearchScreen />} />
                <Route path="/status" element={<StatusScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
                <Route path="/more" element={<MoreScreen />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </SnackbarProvider>
      </LockGate>
    </DataSourceProvider>
  )
}

export function App() {
  return (
    <SettingsProvider>
      <Root />
    </SettingsProvider>
  )
}
