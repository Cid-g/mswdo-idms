'use strict';

// `sex` is a mixed enum ('Male'/'Female' and legacy 'M'/'F'). Normalize in aggregation pipelines.
const SEX_NORMALIZE = {
  $cond: [
    { $in: ['$sex', ['Male', 'M']] },
    'Male',
    { $cond: [{ $in: ['$sex', ['Female', 'F']] }, 'Female', 'Unknown'] },
  ],
};

module.exports = { SEX_NORMALIZE };
