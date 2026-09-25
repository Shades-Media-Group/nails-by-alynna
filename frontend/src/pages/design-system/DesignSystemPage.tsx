import { useState } from 'react';
import { NailArt } from '@/components/brand/NailArt';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Chip } from '@/components/ui';
import { ArrowForwardIcon, CalendarAddIcon } from '@/components/ui/icons';
import { ART_GROUPS } from '@/lib/art';
import { cx } from '@/lib/cx';
import { SWATCH, SWATCH_ORDER, type SwatchColor } from '@/lib/swatch';

/**
 * Internal reference for the owner and developers (administrators only): the illustration
 * collection in every swatch, the button family and the type scale. English only on purpose.
 */
export default function DesignSystemPage() {
  const [color, setColor] = useState<SwatchColor>('blush');

  return (
    <div className="pb-10">
      <PageHeader title="Design system" subtitle="Illustrations, buttons and type as the app uses them." />

      <section className="gutter-x mt-8 lg:px-0" aria-labelledby="art-title">
        <h2 id="art-title" className="text-h2 font-extrabold">
          Illustrations
        </h2>
        <p className="mt-1 text-sm text-ink-600">Each service picks one drawing; the colour comes from its category.</p>
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Swatch">
          {SWATCH_ORDER.map((swatch) => (
            <Chip key={swatch} selected={swatch === color} onClick={() => setColor(swatch)} role="radio" aria-checked={swatch === color}>
              <span className="capitalize">{swatch}</span>
            </Chip>
          ))}
        </div>
        {ART_GROUPS.map((group) => (
          <div key={group.key} className="mt-6">
            <h3 className="text-sm font-semibold capitalize text-ink-600">{group.key}</h3>
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {group.arts.map((art) => (
                <li key={art} className="flex flex-col items-center gap-1.5">
                  <span className={cx('flex aspect-square w-full items-center justify-center rounded-xl p-2', SWATCH[color].field)}>
                    <NailArt art={art} color={color} className="w-full" />
                  </span>
                  <code className="text-xs text-ink-600">{art}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="gutter-x mt-10 lg:px-0" aria-labelledby="buttons-title">
        <h2 id="buttons-title" className="text-h2 font-extrabold">
          Buttons
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button trailingIcon={ArrowForwardIcon}>Book a visit</Button>
          <Button variant="soft" size="md">
            Soft
          </Button>
          <Button variant="outline" size="md" icon={CalendarAddIcon}>
            Outline
          </Button>
          <Button variant="ghost" size="sm">
            Ghost
          </Button>
          <Button variant="brand" size="sm">
            Brand
          </Button>
          <Button variant="danger" size="sm">
            Danger
          </Button>
          <Button size="md" loading>
            Saving
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['neutral', 'rose', 'cyan', 'peach', 'mint', 'red', 'lilac', 'ink'] as const).map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      </section>

      <section className="gutter-x mt-10 lg:px-0" aria-labelledby="type-title">
        <h2 id="type-title" className="text-h2 font-extrabold">
          Type
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-display font-extrabold">Display 40</p>
          <p className="text-h1 font-extrabold">Heading 1 · 28</p>
          <p className="text-h2 font-extrabold">Heading 2 · 20</p>
          <p className="text-h3 font-bold">Heading 3 · 17</p>
          <p className="text-base">Body 16. The quick brown fox books a gel set.</p>
          <p className="text-sm text-ink-600">Small 14. Secondary information.</p>
        </div>
      </section>
    </div>
  );
}
