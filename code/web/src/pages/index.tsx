// 路由：页面名 → 组件。页签里的页面栈和聊天面板都用它。
import type { Route } from '../types'
import type { Nav } from './nav'
import { ChatSettingsPage, EmployeeEditPage, EmployeePage, EmployeesPage, MemoryPage } from './people'
import { IssuePage, IssuesPage, WorkspaceAddPage, WorkspacePage, WorkspacesPage } from './workspace'
import {
  AppsPage, AuditPage, CredentialEditPage, CredentialsPage, DataPage, PluginsPage, QueryPage, ReleasePage, ReleasesPage,
  ServerAddPage, ServerPage, ServersPage, TriggerEditPage, TriggersPage, ChannelsPage, InboxPage, KnowledgePage, FlowsPage,
} from './apps'
import { ChatInfoPage } from '../components/ChatInfo'
import { AboutPage, CustomizePage, HabitsPage, MePage, SecurityPage, SettingsPage, SystemSettingsPage, UsagePage } from './me'
import { MeEditPage } from './meEdit'
import { DiffPage, PlaceholderPage, QueryResultPage } from './panels'
import { LIVE } from '../mode'
import {
  ComingSoonPage, LiveServersPage, ExecutorsPage, LiveAppsPage, LiveDataPage, LiveEmployeePage, LiveKnowledgePage,
  LiveQueryPage, LiveSecurityPage, LiveServerAddPage, LiveServerPage, LiveTriggerEditPage, LiveTriggersPage, LiveWorkspaceAddPage, LiveWorkspacePage, LiveWorkspacesPage,
} from './live'
import { LiveCredentialEditPage, LiveCredentialsPage } from './creds'
import { LiveHistoryPage, LiveIssuePage, LiveIssuesPage, LiveMemoryPage } from './live2'
import { DomainPage, DomainsPage } from './live3'
import { LiveReleasePage, LiveReleasesPage } from './release'
import { LiveChannelsPage, LiveInboxPage } from './live4'

/** 真的一套里还没做的页面 */
const SOON: Partial<Record<Route['page'], string>> = {
  flows: '流程', plugins: '插件', customize: '定制和二开',
  diff: '看改动', queryResult: '查询结果', placeholder: '还在做',
}

function livePage(route: Route, p: { params: Record<string, any>; nav: Nav }) {
  if (SOON[route.page]) return <ComingSoonPage params={{ title: SOON[route.page], ...p.params }} nav={p.nav} />
  switch (route.page) {
    case 'apps': return <LiveAppsPage {...p} />
    case 'servers': return <LiveServersPage {...p} />
    case 'server': return <LiveServerPage {...p} />
    case 'serverAdd': return <LiveServerAddPage {...p} />
    case 'credentials': return <LiveCredentialsPage {...p} />
    case 'credentialEdit': return <LiveCredentialEditPage {...p} />
    case 'data': return <LiveDataPage {...p} />
    case 'dataSourceAdd': return <LiveCredentialEditPage params={{ group: '数据库' }} nav={p.nav} />
    case 'query': return <LiveQueryPage {...p} />
    case 'triggers': return <LiveTriggersPage {...p} />
    case 'triggerEdit': return <LiveTriggerEditPage {...p} />
    case 'knowledge': return <LiveKnowledgePage {...p} />
    case 'workspaces': return <LiveWorkspacesPage {...p} />
    case 'workspace': return <LiveWorkspacePage {...p} />
    case 'workspaceAdd': return <LiveWorkspaceAddPage {...p} />
    case 'employee': case 'profile': return <LiveEmployeePage {...p} />
    case 'security': return <LiveSecurityPage {...p} />
    case 'executors': return <ExecutorsPage {...p} />
    case 'comingSoon': return <ComingSoonPage {...p} />
    case 'issues': return <LiveIssuesPage {...p} />
    case 'issue': return <LiveIssuePage {...p} />
    case 'memory': return <LiveMemoryPage {...p} />
    case 'history': return <LiveHistoryPage {...p} />
    case 'releases': return <LiveReleasesPage {...p} />
    case 'release': return <LiveReleasePage {...p} />
    case 'domains': return <DomainsPage {...p} />
    case 'channels': return <LiveChannelsPage {...p} />
    case 'inbox': return <LiveInboxPage {...p} />
    case 'domain': return <DomainPage {...p} />
  }
  return null
}

export function PageView({ route, nav }: { route: Route; nav: Nav }) {
  const p = { params: route.params ?? {}, nav }
  if (LIVE) { const lp = livePage(route, p); if (lp) return lp }
  switch (route.page) {
    case 'employees': return <EmployeesPage {...p} />
    case 'employee': return <EmployeePage {...p} />
    case 'employeeEdit': return <EmployeeEditPage {...p} />
    case 'memory': return <MemoryPage {...p} />
    case 'workspaces': return <WorkspacesPage {...p} />
    case 'workspace': return <WorkspacePage {...p} />
    case 'workspaceAdd': return <WorkspaceAddPage {...p} />
    case 'issues': return <IssuesPage {...p} />
    case 'issue': return <IssuePage {...p} />
    case 'apps': return <AppsPage {...p} />
    case 'servers': return <ServersPage {...p} />
    case 'server': return <ServerPage {...p} />
    case 'serverAdd': return <ServerAddPage {...p} />
    case 'releases': return <ReleasesPage {...p} />
    case 'release': return <ReleasePage {...p} />
    case 'credentials': return <CredentialsPage {...p} />
    case 'credentialEdit': return <CredentialEditPage {...p} />
    case 'data': return <DataPage {...p} />
    case 'query': return <QueryPage {...p} />
    case 'triggers': return <TriggersPage {...p} />
    case 'triggerEdit': return <TriggerEditPage {...p} />
    case 'plugins': return <PluginsPage {...p} />
    case 'audit': return <AuditPage {...p} />
    case 'me': return <MePage {...p} />
    case 'meEdit': return <MeEditPage {...p} />
    case 'settings': return <SettingsPage {...p} />
    case 'chatInfo': return <ChatInfoPage {...p} />
    case 'system': return <SystemSettingsPage {...p} />
    case 'usage': return <UsagePage {...p} />
    case 'security': return <SecurityPage {...p} />
    case 'about': return <AboutPage {...p} />
    case 'habits': return <HabitsPage {...p} />
    case 'chatSettings': return <ChatSettingsPage {...p} />
    case 'channels': return <ChannelsPage {...p} />
    case 'inbox': return <InboxPage {...p} />
    case 'knowledge': return <KnowledgePage {...p} />
    case 'flows': return <FlowsPage {...p} />
    case 'customize': return <CustomizePage {...p} />
    case 'diff': return <DiffPage {...p} />
    case 'queryResult': return <QueryResultPage {...p} />
    case 'profile': return <EmployeePage {...p} />
    default: return <PlaceholderPage {...p} />
  }
}
