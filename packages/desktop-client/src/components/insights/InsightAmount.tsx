import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

type InsightAmountProps = {
  value: number;
  /** Render the magnitude, for a sentence that already carries the direction. */
  absolute?: boolean;
};

/**
 * Every money figure on the card goes through here.
 *
 * Two fiddly details, both easy to get wrong:
 *
 *  - `PrivacyFilter` renders a `<div>` (`display: inline-flex`) when privacy
 *    mode is on. A `<div>` inside a `<span>` is invalid HTML, and `Text` is a
 *    `<span>` — which is why `InsightSentence` wraps each sentence in a
 *    block-level container rather than a `Text`.
 *  - `PrivacyOverlay` hardcodes `flexGrow: 1`, which stretches the redaction box
 *    across the row and lifts it off the baseline. Both are overridden below.
 *
 * The figure carries `fontWeight: 600` rather than a colour: it is the part of
 * the sentence that matters, and weight survives greyscale and colour blindness
 * in a way a hue does not.
 */
export function InsightAmount({ value, absolute = false }: InsightAmountProps) {
  const format = useFormat();
  const amount = absolute ? Math.abs(value) : value;

  return (
    <PrivacyFilter
      style={{
        display: 'inline-flex',
        flexGrow: 0,
        verticalAlign: 'baseline',
      }}
    >
      <FinancialText as={Text} style={{ fontWeight: 600, ...styles.tnum }}>
        {format(amount, 'financial')}
      </FinancialText>
    </PrivacyFilter>
  );
}
