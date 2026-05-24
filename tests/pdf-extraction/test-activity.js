import { extractActivityProjectItemsFromPdfText } from '../../services/pdf-activity-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Activity 1
1. Title
Shadow Observation Lab
2. Learning Objectives
- Observe shadow length at different times
- Relate shadow to Sun position
3. Materials Required
- Torch
- Ruler
- White sheet
4. Step-by-step Procedure
1. Place object in sunlight.
2. Mark shadow length every hour.
3. Record observations in table.

Activity 2
1. Title
Plant Growth Journal
2. Learning Objectives
- Record daily plant height
3. Materials Required
- Potted plant
- Measuring tape
4. Step-by-step Procedure
1. Measure plant each morning.
2. Draw growth chart.
`;

const ok = runExtractTest('activity-project-generator', extractActivityProjectItemsFromPdfText, sample, {
  minCount: 1,
});
process.exit(ok ? 0 : 1);
