import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';

import { AmazonLookupButton } from './AmazonLookupButton';

describe('AmazonLookupButton', () => {
  it('renders nothing when the payee is not Amazon', () => {
    render(<AmazonLookupButton payeeName="Home Depot" />);

    expect(screen.queryByTestId('amazon-lookup-button')).toBeNull();
  });

  it('renders for an Amazon payee', () => {
    render(<AmazonLookupButton payeeName="AMZN Mktp US*1A2B3" />);

    expect(screen.getByTestId('amazon-lookup-button')).toBeInTheDocument();
  });

  it('renders when only the imported payee looks like Amazon', () => {
    render(
      <AmazonLookupButton
        payeeName="Online shopping"
        importedPayeeName="AMAZON.COM*RT4G92QP3"
      />,
    );

    expect(screen.getByTestId('amazon-lookup-button')).toBeInTheDocument();
  });

  it('opens the Amazon transactions page when pressed', () => {
    const openURLInBrowser = vi.fn();
    window.Actual.openURLInBrowser = openURLInBrowser;

    render(<AmazonLookupButton payeeName="Amazon.com" />);
    fireEvent.click(screen.getByTestId('amazon-lookup-button'));

    expect(openURLInBrowser).toHaveBeenCalledWith(
      'https://www.amazon.com/cpe/yourpayments/transactions',
    );
  });
});
