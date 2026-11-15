/**
 * Practical units offered to every company.
 *
 * Codes follow the GST/UQC abbreviations where one exists. A few service and
 * business units (hour, day, month and job) are included because they are
 * routinely used on invoices even though they do not describe physical stock.
 */
export const COMMON_UOMS = [
  ['BAG', 'Bags', 'Packaging'], ['BAL', 'Bale', 'Packaging'], ['BDL', 'Bundles', 'Packaging'],
  ['BKL', 'Buckles', 'Packaging'], ['BOU', 'Billions of units', 'Count'], ['BOX', 'Boxes', 'Packaging'],
  ['BTL', 'Bottles', 'Packaging'], ['BUN', 'Bunches', 'Packaging'], ['CAN', 'Cans', 'Packaging'],
  ['CTN', 'Cartons', 'Packaging'], ['DRM', 'Drums', 'Packaging'], ['PAC', 'Packs', 'Packaging'],
  ['ROL', 'Rolls', 'Packaging'], ['TUB', 'Tubes', 'Packaging'],
  ['NOS', 'Numbers', 'Count'], ['PCS', 'Pieces', 'Count'], ['PRS', 'Pairs', 'Count'],
  ['SET', 'Sets', 'Count'], ['DOZ', 'Dozens', 'Count'], ['GRS', 'Gross', 'Count'],
  ['THD', 'Thousands', 'Count'], ['GGR', 'Great gross', 'Count'], ['UGS', 'US gallons', 'Volume'],
  ['MLT', 'Millilitres', 'Volume'], ['LTR', 'Litres', 'Volume'], ['KLR', 'Kilolitres', 'Volume'],
  ['CCM', 'Cubic centimetres', 'Volume'], ['CBM', 'Cubic metres', 'Volume'],
  ['MGM', 'Milligrams', 'Weight'], ['GMS', 'Grams', 'Weight'], ['KGS', 'Kilograms', 'Weight'],
  ['QTL', 'Quintals', 'Weight'], ['TON', 'Tonnes', 'Weight'],
  ['MMT', 'Millimetres', 'Length'], ['CMT', 'Centimetres', 'Length'], ['MTR', 'Metres', 'Length'],
  ['KME', 'Kilometres', 'Length'], ['YDS', 'Yards', 'Length'],
  ['SQF', 'Square feet', 'Area'], ['SQM', 'Square metres', 'Area'], ['SQY', 'Square yards', 'Area'],
  ['ACR', 'Acres', 'Area'], ['HEC', 'Hectares', 'Area'],
  ['HRS', 'Hours', 'Time'], ['DAY', 'Days', 'Time'], ['WEE', 'Weeks', 'Time'],
  ['MON', 'Months', 'Time'], ['YER', 'Years', 'Time'],
  ['JOB', 'Jobs', 'Service'], ['UNT', 'Units', 'Other'], ['LOT', 'Lots', 'Other'],
].map(([code, name, category]) => ({ code, name, category }));

