import { Toaster as Sonner } from 'sonner';

/** App-wide toasts, themed to the ink/blush system and kept clear of the tab bar. */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={{ top: 'calc(var(--safe-top) + 12px)' }}
      mobileOffset={{ top: 'calc(var(--safe-top) + 12px)' }}
      gap={10}
      visibleToasts={3}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-start gap-3 rounded-xl bg-ink-900 px-4 py-3.5 text-white shadow-float md:w-[22rem] font-sans',
          title: 'text-[0.9375rem] font-semibold',
          description: 'mt-0.5 text-sm text-ink-200',
          actionButton:
            'ml-auto shrink-0 rounded-pill bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-900 press',
          cancelButton: 'shrink-0 rounded-pill px-3 py-1.5 text-sm font-semibold text-ink-200',
          icon: 'mt-0.5 text-rose-200',
          error: 'bg-red-700',
          success: 'bg-ink-900',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
