import { useTranslation } from 'react-i18next';
import { IconButton, TextField } from '@/components/ui';
import { CloseIcon, SearchIcon } from '@/components/ui/icons';

/** Search box with a clear button; the label doubles as the placeholder and stays for screen readers. */
export function SearchField({
  label,
  value,
  onChange,
  className,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <TextField
      label={label}
      hideLabel
      placeholder={label}
      icon={SearchIcon}
      type="text"
      role="searchbox"
      enterKeyHint="search"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.preventDefault();
          onChange('');
        }
      }}
      className={className}
      trailing={value ? <IconButton icon={CloseIcon} label={t('actions.clear')} onClick={() => onChange('')} /> : undefined}
    />
  );
}
