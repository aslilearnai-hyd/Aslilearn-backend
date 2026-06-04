import { extractActivityProjectItemsFromPdfText } from '../../services/pdf-activity-extract.js';
import { runExtractTest } from './_helpers.js';

const thirteenPointSample = `
Activity 23
1. Title of the Activity / Project
Discovering Mathematics Activity 23
2. Subtopic Link and Prior Knowledge Required
Students should know basic shapes and units of measurement from earlier classes and daily-life observations.
3. Learning Objectives
- Measure lengths using a ruler
- Compare perimeters of simple figures
4. NCF Competency / Learning Outcome Alignment
Develops mathematical reasoning, communication, and observation skills.
5. Materials Required
- Ruler
- Notebook
- Pencil
6. Step-by-step Procedure
1. Draw three rectangles on paper.
2. Measure each side with a ruler.
3. Record perimeters in a table.
`;

const ok = runExtractTest(
  'activity-project-generator',
  (text, limit, slug) => extractActivityProjectItemsFromPdfText(text, limit, slug),
  thirteenPointSample,
  {
    minCount: 1,
    assertItem: (item) => {
      const sub = String(item.subtopic_link_prior_knowledge || '');
      const ncf = String(item.ncf_competency_alignment || '');
      if (sub.startsWith('and ')) throw new Error(`subtopic fragment: ${sub}`);
      if (ncf.startsWith('communication')) throw new Error(`ncf fragment: ${ncf}`);
      if (!Array.isArray(item.learning_objectives) || item.learning_objectives.length < 1) {
        throw new Error('missing learning objectives');
      }
      if (!Array.isArray(item.materials_required) || item.materials_required.length < 1) {
        throw new Error('missing materials');
      }
    },
  },
);

process.exit(ok ? 0 : 1);
