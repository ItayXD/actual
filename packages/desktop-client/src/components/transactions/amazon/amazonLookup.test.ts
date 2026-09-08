import { describe, expect, it } from 'vitest';

import { isAmazonPayee } from './amazonLookup';

describe('isAmazonPayee', () => {
  it.each([
    'Amazon',
    'Amazon.com',
    'AMAZON.COM*RT4G92QP3',
    'AMZN Mktp US*1A2B3',
    'AMZNMktplace',
    'Amazon Prime',
    'Amazon Fresh',
    'Amazon Web Services',
    'Payment to amazon digital svcs',
  ])('matches %s', name => {
    expect(isAmazonPayee(name)).toBe(true);
  });

  it.each([
    'Blazon Media',
    'Kamazonia Cafe',
    'Target',
    'Amazing Grains',
    '',
    null,
    undefined,
  ])('does not match %s', name => {
    expect(isAmazonPayee(name)).toBe(false);
  });

  it('matches when any of the given names matches', () => {
    expect(isAmazonPayee(null, 'AMZN Mktp US*1A2B3')).toBe(true);
    expect(isAmazonPayee('Groceries', undefined)).toBe(false);
  });
});
