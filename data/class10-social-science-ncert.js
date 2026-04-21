/**
 * Class X — Social Science (NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 10 + Social Science.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_10_SOCIAL_SCIENCE_NCERT_CHAPTERS = [
  {
    title: 'Geography Chapter 1: Resources and Development',
    subtopics: [
      '1.1 Types of Resources - Biotic/Abiotic, Renewable/Non-Renewable, Individual/Community/National/International',
      '1.2 Development of Resources',
      '1.3 Resource Planning in India',
      '1.4 Land Resources',
      '1.5 Land Use Pattern in India',
      '1.6 Land Degradation and Conservation',
      '1.7 Soil as a Resource - Classification of Soils',
      '1.8 Soil Erosion and Soil Conservation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Geography Chapter 2: Forest and Wildlife Resources',
    subtopics: [
      '2.1 Biodiversity - Flora and Fauna in India',
      '2.2 Vanishing Forests',
      '2.3 Asiatic Cheetah - Where Did They Go?',
      '2.4 The Himalayan Yew in Trouble',
      '2.5 Conservation of Forest and Wildlife in India',
      '2.6 Project Tiger',
      '2.7 Types and Distribution of Forest and Wildlife Resources',
      '2.8 Community and Conservation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Geography Chapter 3: Water Resources',
    subtopics: [
      '3.1 Water Scarcity and the Need for Water Conservation',
      '3.2 Multi-Purpose River Projects and Integrated Water Resources Management',
      '3.3 Rainwater Harvesting',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Geography Chapter 4: Agriculture',
    subtopics: [
      '4.1 Types of Farming - Primitive Subsistence, Intensive Subsistence, Commercial',
      '4.2 Cropping Pattern - Rabi, Kharif, Zaid',
      '4.3 Major Crops - Rice, Wheat, Millets, Pulses, Tea, Coffee, Horticulture, Rubber, Fibre Crops, Sugarcane, Oilseeds',
      '4.4 Technological and Institutional Reforms',
      '4.5 Contribution of Agriculture to the National Economy - Employment and Output',
      '4.6 Impact of Globalisation on Agriculture',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Geography Chapter 5: Minerals and Energy Resources',
    subtopics: [
      '5.1 What is a Mineral?',
      '5.2 Mode of Occurrence of Minerals',
      '5.3 Ferrous and Non-Ferrous Minerals',
      '5.4 Non-Metallic Minerals',
      '5.5 Rock Minerals',
      '5.6 Conservation of Minerals',
      '5.7 Energy Resources - Conventional Sources (Coal, Petroleum, Natural Gas, Electricity)',
      '5.8 Non-Conventional Sources (Nuclear, Solar, Wind, Biogas, Tidal, Geothermal)',
      '5.9 Conservation of Energy Resources',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Geography Chapter 6: Manufacturing Industries',
    subtopics: [
      '6.1 Importance of Manufacturing',
      '6.2 Contribution of Industry to National Economy',
      '6.3 Industrial Location',
      '6.4 Classification of Industries',
      '6.5 Agro-based Industries - Textile, Sugar',
      '6.6 Mineral-based Industries - Iron and Steel, Aluminium Smelting',
      '6.7 Chemical, Fertiliser, Cement, Automobile, IT Industries',
      '6.8 Industrial Pollution and Environmental Degradation',
      '6.9 Control of Environmental Degradation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Geography Chapter 7: Lifelines of National Economy',
    subtopics: [
      '7.1 Transport - Roadways, Railways, Pipelines, Waterways, Airways',
      '7.2 Communication',
      '7.3 International Trade',
      '7.4 Tourism as a Trade',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Economics Chapter 1: Development',
    subtopics: [
      '1.1 What Development Promises - Different People, Different Goals',
      '1.2 Income and Other Criteria',
      '1.3 National Development',
      '1.4 How to Compare Different Countries or States? - Per Capita Income',
      '1.5 Public Facilities',
      '1.6 Sustainability of Development',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Economics Chapter 2: Sectors of the Indian Economy',
    subtopics: [
      '2.1 Sectors of Economic Activities - Primary, Secondary, Tertiary',
      '2.2 Comparing the Three Sectors',
      '2.3 Primary, Secondary and Tertiary Sectors in India',
      '2.4 Division of Sectors as Organised and Unorganised',
      '2.5 Sectors in Terms of Ownership - Public and Private Sectors',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Economics Chapter 3: Money and Credit',
    subtopics: [
      '3.1 Money as a Medium of Exchange',
      '3.2 Modern Forms of Money',
      '3.3 Loan Activities of Banks',
      '3.4 Two Different Credit Situations',
      '3.5 Terms of Credit',
      '3.6 Formal Sector Credit in India',
      '3.7 Self-Help Groups for the Poor',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Economics Chapter 4: Globalisation and the Indian Economy',
    subtopics: [
      '4.1 Production across Countries',
      '4.2 Interlinking Production across Countries - MNCs',
      '4.3 Foreign Trade and Integration of Markets',
      '4.4 What is Globalisation?',
      '4.5 Factors that have Enabled Globalisation - Technology, Liberalisation',
      '4.6 World Trade Organisation',
      '4.7 Impact of Globalisation on India',
      '4.8 The Struggle for a Fair Globalisation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Economics Chapter 5: Consumer Rights',
    subtopics: [
      '5.1 The Consumer in the Marketplace',
      '5.2 Consumer Movement',
      '5.3 Consumer Rights - Right to Safety, Information, Choice, Redressal, Represent',
      '5.4 Learning to Become a Well-Informed Consumer',
      '5.5 Taking the Consumer Movement Forward',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'History Chapter 1: The Rise of Nationalism in Europe',
    subtopics: [
      '1.1 The French Revolution and the Idea of the Nation',
      '1.2 The Making of Nationalism in Europe',
      '1.3 The Age of Revolutions (1830-1848)',
      '1.4 The Making of Germany and Italy',
      '1.5 Visualising the Nation',
      '1.6 Nationalism and Imperialism',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'History Chapter 2: Nationalism in India',
    subtopics: [
      '2.1 The First World War, Khilafat and Non-Cooperation',
      '2.2 Differing Strands within the Movement',
      '2.3 Towards Civil Disobedience',
      '2.4 The Sense of Collective Belonging',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'History Chapter 3: The Making of a Global World',
    subtopics: [
      '3.1 The Pre-modern World',
      '3.2 The Nineteenth Century (1815-1914)',
      '3.3 The Inter-war Economy',
      '3.4 Rebuilding a World Economy: The Post-war Era',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'History Chapter 4: The Age of Industrialisation',
    subtopics: [
      '4.1 Before the Industrial Revolution',
      '4.2 Hand Labour and Steam Power',
      '4.3 Industrialisation in the Colonies',
      '4.4 Factories Come Up',
      '4.5 The Peculiarities of Industrial Growth',
      '4.6 Market for Goods',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'History Chapter 5: Print Culture and the Modern World',
    subtopics: [
      '5.1 The First Printed Books',
      '5.2 Print Comes to Europe',
      '5.3 The Print Revolution and its Impact',
      '5.4 The Reading Mania',
      '5.5 The Nineteenth Century - Further Innovations',
      '5.6 India and the World of Print',
      '5.7 Religious Reform and Public Debates',
      '5.8 New Forms of Publication',
      '5.9 Print and Censorship',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Political Science Chapter 1: Power Sharing',
    subtopics: [
      '1.1 Case Studies - Belgium and Sri Lanka',
      '1.2 Why Power Sharing is Desirable?',
      '1.3 Forms of Power Sharing - Horizontal, Vertical, Community, Political Party/Pressure Group',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Political Science Chapter 2: Federalism',
    subtopics: [
      '2.1 What is Federalism?',
      '2.2 What Makes India a Federal Country?',
      '2.3 How is Federalism Practised? - Linguistic States, Language Policy, Centre-State Relations',
      '2.4 Decentralisation in India - Local Government',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Political Science Chapter 3: Gender, Religion and Caste',
    subtopics: [
      "3.1 Gender and Politics - Public/Private Division, Women's Political Representation",
      '3.2 Religion, Communalism and Politics',
      '3.3 Caste and Politics - Caste in Politics, Politics in Caste',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Political Science Chapter 4: Political Parties',
    subtopics: [
      '4.1 Why Do We Need Political Parties? - Functions, Necessity',
      '4.2 How Many Parties Should We Have? - One-Party, Two-Party, Multi-Party System',
      '4.3 National and State Parties in India',
      '4.4 Challenges to Political Parties',
      '4.5 How can Parties be Reformed?',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Political Science Chapter 5: Outcomes of Democracy',
    subtopics: [
      "5.1 How do we assess democracy's outcomes?",
      '5.2 Accountable, Responsive and Legitimate Government',
      '5.3 Economic Growth and Development',
      '5.4 Reduction of Inequality and Poverty',
      '5.5 Accommodation of Social Diversity',
      '5.6 Dignity and Freedom of the Citizens',
      EXERCISE_LINE,
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass10SocialScienceSubject(subjectId) {
  const s = norm(subjectId);
  return (
    s.includes('social science') ||
    s.includes('social studies') ||
    s.includes('sst') ||
    s.includes('history') ||
    s.includes('geography') ||
    s.includes('civics') ||
    s.includes('political science') ||
    s.includes('economics')
  );
}

export function matchClass10SocialScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_10_SOCIAL_SCIENCE_NCERT_CHAPTERS);
}
