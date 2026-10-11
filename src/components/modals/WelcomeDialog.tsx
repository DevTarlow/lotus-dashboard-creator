import { SparklesIcon, TrashIcon } from '@/components/icons';
import { Button, Modal } from '@/components/ui';
import { GettingStarted } from '@/components/modals/GettingStarted';
import { COMPLETE_TEMPLATE_ID, getTemplate } from '@/lib/templates';
import { useDashboardStore } from '@/store/dashboardStore';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';

/**
 * The first thing a new visitor sees.
 *
 * Shown once, when nothing at all was stored for this document — a saved file
 * someone just received, or a genuinely first visit. "Nothing here is permanent"
 * is the point: every control in the app is reversible, and the panel would be
 * doing harm if it made people afraid to touch anything.
 */
export function WelcomeDialog() {
  const open = useUiStore((state) => state.welcomeOpen);
  const closeWelcome = useUiStore((state) => state.closeWelcome);
  const openAddWidget = useUiStore((state) => state.openAddWidget);
  const setHasSeenWelcome = usePrefsStore((state) => state.setHasSeenWelcome);
  const applyTemplate = useDashboardStore((state) => state.applyTemplate);
  const clearDashboard = useDashboardStore((state) => state.clearDashboard);

  const dismiss = () => {
    setHasSeenWelcome(true);
    closeWelcome();
  };

  const addFirstWidget = () => {
    dismiss();
    openAddWidget();
  };

  const showExample = () => {
    const complete = getTemplate(COMPLETE_TEMPLATE_ID);
    if (complete) applyTemplate(complete);
    dismiss();
  };

  const startBlank = () => {
    clearDashboard();
    dismiss();
    openAddWidget();
  };

  return (
    <Modal
      open={open}
      onClose={dismiss}
      size="md"
      title="Welcome — this is your dashboard"
      description="Nothing here is permanent. Move things around, add widgets, change the colours — everything can be undone."
      footer={
        <>
          <button
            type="button"
            onClick={dismiss}
            className="mr-auto text-xs text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
          >
            Maybe later
          </button>
          <Button variant="ghost" size="sm" icon={<TrashIcon className="h-3.5 w-3.5" />} onClick={startBlank}>
            Start blank
          </Button>
          <Button variant="secondary" size="sm" icon={<SparklesIcon className="h-3.5 w-3.5" />} onClick={showExample}>
            Show me an example
          </Button>
          <Button variant="primary" size="sm" onClick={addFirstWidget}>
            Add my first widget
          </Button>
        </>
      }
    >
      <GettingStarted />
    </Modal>
  );
}
