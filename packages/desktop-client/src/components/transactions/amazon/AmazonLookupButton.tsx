import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgBox } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { isAmazonPayee, openAmazonTransactions } from './amazonLookup';

type AmazonLookupButtonProps = {
  payeeName?: string | null;
  importedPayeeName?: string | null;
};

/**
 * Lookup button for the mobile transaction editor, rendered under the category
 * field of an uncategorized transaction. Renders nothing unless the payee looks
 * like Amazon, since an Amazon order can't be categorized without knowing what
 * was in it.
 */
export function AmazonLookupButton({
  payeeName,
  importedPayeeName,
}: AmazonLookupButtonProps) {
  if (!isAmazonPayee(payeeName, importedPayeeName)) {
    return null;
  }

  return (
    <View
      style={{
        marginTop: 8,
        padding: `0 ${styles.mobileEditingPadding}px`,
      }}
    >
      <Button
        variant="bare"
        data-testid="amazon-lookup-button"
        onPress={openAmazonTransactions}
        style={{
          alignSelf: 'flex-start',
          color: theme.pageTextLink,
          padding: '6px 8px',
        }}
      >
        <SvgBox width={13} height={13} style={{ marginRight: 6 }} />
        <Trans>Look this order up on Amazon</Trans>
      </Button>
    </View>
  );
}
