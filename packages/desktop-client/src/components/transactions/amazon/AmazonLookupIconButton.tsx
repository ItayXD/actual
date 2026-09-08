import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgBox } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';

import { openAmazonTransactions } from './amazonLookup';

/**
 * Compact lookup button for the transaction table's category cell: an Amazon
 * order can't be categorized without knowing what was in it, so offer a jump to
 * the Amazon transactions page right where the category is missing.
 */
export function AmazonLookupIconButton() {
  const { t } = useTranslation();

  return (
    <View
      // The category cell exposes its autocomplete on any click inside it;
      // don't open that behind the browser tab we're about to raise.
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{ flexShrink: 0 }}
    >
      <Tooltip
        content={
          <View style={{ padding: 10 }}>
            <Text>
              <Trans>Open your Amazon transactions to see this order</Trans>
            </Text>
          </View>
        }
        placement="bottom"
        triggerProps={{ delay: 500 }}
        style={styles.tooltip}
      >
        <Button
          variant="bare"
          data-testid="amazon-lookup-button"
          aria-label={t('Open your Amazon transactions')}
          style={{
            color: 'inherit',
            width: 20,
            height: 20,
            padding: 0,
            flexShrink: 0,
          }}
          onPress={openAmazonTransactions}
        >
          <SvgBox style={{ width: 11, height: 11 }} />
        </Button>
      </Tooltip>
    </View>
  );
}
