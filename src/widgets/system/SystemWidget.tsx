import { useMemo, useState } from 'react';
import { BatteryIcon, MonitorIcon, RefreshIcon, SystemIcon, WifiIcon } from '@/components/icons';
import { Badge, Button, ProgressBar, SourceBadge, StatTile } from '@/components/ui';
import {
  useBatteryStatus,
  useDocumentVisibility,
  useNetworkStatus,
  useStorageStatus,
} from '@/hooks/useSystemReadings';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import {
  browserNavigator,
  browserWindow,
  deviceStatus,
  fetchPublicIp,
  formatBytes,
  formatSeconds,
  type BatteryStatus,
  type PublicIpInfo,
} from '@/lib/system';
import { formatDuration } from '@/lib/time';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type SystemConfig = {
  /** Opt-in: this is the only reading that leaves the machine. */
  showNetwork: boolean;
  showBattery: boolean;
  showStorage: boolean;
  showDevice: boolean;
};

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  showNetwork: false,
  showBattery: true,
  showStorage: true,
  showDevice: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'showDevice',
    label: 'Show device details',
    type: 'switch',
    help: 'Platform, processor count, memory, screen and language, all read locally.',
  },
  { key: 'showBattery', label: 'Show battery', type: 'switch', help: 'Chromium browsers only.' },
  { key: 'showStorage', label: 'Show storage usage', type: 'switch' },
  {
    key: 'showNetwork',
    label: 'Look up the public IP address',
    type: 'switch',
    help: 'Off by default. When it is on, it sends one request to ipwho.is, which sees your IP address. The dashboard sends that address nowhere else.',
  },
];

/** One label/value line. */
function Row({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-0.5 text-[11px] last:border-0 dark:border-slate-800">
      <dt className="shrink-0 text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="truncate text-right font-medium text-slate-700 dark:text-slate-200" title={title}>
        {value}
      </dd>
    </div>
  );
}

function SectionTitle({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <h4 className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 first:mt-0 dark:text-slate-500">
      {icon}
      {children}
    </h4>
  );
}

/** "charging · 1h 20m to full" / "on battery · 45m left" / "charging state unknown". */
function batteryCaption(battery: BatteryStatus): string {
  if (battery.charging === null) return 'charging state unknown';
  if (battery.charging) {
    const untilFull = formatSeconds(battery.chargingTimeSeconds);
    return untilFull === '—' ? 'charging' : `charging · ${untilFull} to full`;
  }
  const left = formatSeconds(battery.dischargingTimeSeconds);
  return left === '—' ? 'on battery' : `on battery · ${left} left`;
}

/** Read-only view of the browser, the device and the connection it is on. */
export function SystemWidget({ config }: WidgetProps<SystemConfig>) {
  const now = useNow(30_000);
  const network = useNetworkStatus();
  const battery = useBatteryStatus(config.showBattery);
  const storage = useStorageStatus(config.showStorage);
  const visible = useDocumentVisibility();
  const [mountedAt] = useState(() => Date.now());

  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  const device = useMemo(
    () => deviceStatus(browserNavigator(), browserWindow(), timeZone),
    [timeZone],
  );

  const {
    data: publicIp,
    error,
    errorCode,
    errorStatus,
    pending,
    fromCache,
    refresh,
  } = useResource<{ info: PublicIpInfo | null; fromCache: boolean }>({
    key: 'ipwhois:me',
    refreshMs: 60 * 60 * 1000,
    enabled: config.showNetwork,
    load: async (signal) => {
      const result = await fetchPublicIp(signal);
      return { data: result, fromCache: result.fromCache };
    },
  });

  const storageRatio =
    storage?.supported && storage.usageBytes !== null && storage.quotaBytes !== null && storage.quotaBytes > 0
      ? storage.usageBytes / storage.quotaBytes
      : null;

  return (
    <div className="@container flex h-full flex-col gap-2 text-slate-700 dark:text-slate-200">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={network.online ? 'emerald' : 'amber'}>{network.online ? 'Online' : 'Offline'}</Badge>
        {network.effectiveType ? <Badge tone="sky">{network.effectiveType.toUpperCase()}</Badge> : null}
        {network.saveData ? <Badge tone="violet">Data saver</Badge> : null}
        {device.touch ? <Badge tone="slate">Touch</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <StatTile label="Uptime" value={formatDuration(now.getTime() - mountedAt)} hint="this page" />
        {config.showStorage ? (
          <StatTile
            label="Storage"
            value={storage?.supported ? formatBytes(storage.usageBytes) : '—'}
            hint={
              storage === null
                ? 'reading…'
                : storage.supported
                  ? `of ${formatBytes(storage.quotaBytes)}`
                  : 'not available here'
            }
            tone="sky"
          />
        ) : null}
      </div>

      {config.showStorage && storageRatio !== null ? (
        <ProgressBar
          value={storageRatio}
          tone="sky"
          label="Storage used"
          caption="Browser storage used by this site"
          valueLabel={`${(storageRatio * 100).toFixed(1)}%`}
        />
      ) : null}

      {config.showBattery ? (
        <>
          <SectionTitle icon={<BatteryIcon className="h-3.5 w-3.5" />}>Battery</SectionTitle>
          {battery === null ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Reading battery state…</p>
          ) : battery.supported ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">
                  {battery.level === null ? '—' : `${Math.round(battery.level * 100)}%`}
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{batteryCaption(battery)}</span>
              </div>
              {battery.level !== null ? (
                <ProgressBar
                  value={battery.level}
                  tone={battery.level <= 0.2 ? 'rose' : battery.charging ? 'emerald' : 'amber'}
                  label="Battery level"
                />
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              This browser does not report battery state (Chromium-based browsers do).
            </p>
          )}
        </>
      ) : null}

      {config.showNetwork ? (
        <>
          <SectionTitle icon={<WifiIcon className="h-3.5 w-3.5" />}>
            Connection
            <span className="ml-auto flex items-center gap-1 font-normal normal-case tracking-normal">
              <SourceBadge input={{ pending, error, errorCode, status: errorStatus, fromCache }} />
            </span>
          </SectionTitle>
          {pending && !publicIp ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Looking up the public address…</p>
          ) : null}
          {error ? (
            <div className="flex items-center gap-2">
              <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
              <Button size="sm" variant="ghost" icon={<RefreshIcon className="h-3.5 w-3.5" />} onClick={refresh}>
                Retry
              </Button>
            </div>
          ) : null}
          {publicIp?.info ? (
            <dl className="space-y-0">
              <Row label="Public IP" value={publicIp.info.ip} />
              <Row
                label="Location"
                value={
                  [publicIp.info.city, publicIp.info.country].filter(Boolean).join(', ') || '—'
                }
                title={publicIp.info.region ?? undefined}
              />
              <Row label="Provider" value={publicIp.info.org ?? '—'} />
            </dl>
          ) : null}
          {publicIp && publicIp.info === null ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              The lookup answered without an address (a private or filtered network).
            </p>
          ) : null}
          {/* Read locally, so they are shown whether or not the lookup worked. */}
          <dl className="space-y-0">
            {network.downlinkMbps !== null ? <Row label="Downlink" value={`~${network.downlinkMbps} Mbps`} /> : null}
            {network.rttMs !== null ? <Row label="Latency" value={`~${network.rttMs} ms`} /> : null}
          </dl>
          {!network.detailed ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              This browser does not expose connection details.
            </p>
          ) : null}
        </>
      ) : null}

      {config.showDevice ? (
        <>
          <SectionTitle icon={<MonitorIcon className="h-3.5 w-3.5" />}>Device</SectionTitle>
          <dl className="space-y-0">
            <Row label="Platform" value={device.platform} />
            <Row label="Processor" value={device.cores === null ? '—' : `${device.cores} threads`} />
            <Row label="Memory" value={device.memoryGb === null ? '—' : `~${device.memoryGb} GB`} />
            <Row label="Screen" value={device.screen === null ? '—' : `${device.screen.width}×${device.screen.height}`} />
            <Row label="Pixel ratio" value={device.pixelRatio === null ? '—' : `${device.pixelRatio}×`} />
            <Row label="Language" value={device.language} />
            <Row label="Time zone" value={device.timeZone.replace(/_/g, ' ')} />
            <Row label="Page shown" value={visible ? 'Visible' : 'Hidden'} />
          </dl>
        </>
      ) : null}
    </div>
  );
}

export const systemWidget = defineWidget<SystemConfig>({
  type: 'system',
  name: 'System & device',
  summary: 'Connection, battery, storage and device details, read locally.',
  category: 'utilities',
  keywords: ['browser', 'device', 'battery', 'storage', 'network', 'ip', 'memory', 'diagnostics'],
  icon: SystemIcon,
  accent: 'slate',
  defaultSize: { w: 4, h: 7, minW: 3, minH: 4 },
  defaultConfig: DEFAULT_SYSTEM_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const parts = [
      config.showDevice ? 'device' : null,
      config.showBattery ? 'battery' : null,
      config.showStorage ? 'storage' : null,
      config.showNetwork ? 'network' : null,
    ].filter((part): part is string => part !== null);
    // The status chips and the uptime tile are always on, so "everything hidden"
    // is never quite true — say what is actually left instead.
    return parts.length === 0 ? 'Status and uptime' : parts.join(' · ');
  },
  component: SystemWidget,
});
