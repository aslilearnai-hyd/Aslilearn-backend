# AsliLearn Backend

Node.js API for the AsliLearn education platform. It supports web and mobile clients, application data, role-based access and AI-assisted educational workflows.

## Stack

JavaScript ES modules, Express, MongoDB/Mongoose and AI-provider integrations.

## Features

- Authentication and role-based access for students, teachers and administrators.
- School, class, subject and educational-content management.
- Exams, quizzes, homework and learning-progress APIs.
- Vidya AI conversation routing and educational tools.
- Textbook retrieval and book-based content generation.
- Subscription and payment integration endpoints.

## Project structure

```text
index.js       Main application entry point
routes/        HTTP route definitions
controllers/   Request handlers
services/      Application services and workflow orchestration
models/        MongoDB schemas
middleware/    Authentication, access and request middleware
config/        Application configuration
ai/            AI providers, prompts, generators and retrieval
validators/    Validation helpers
tests/         Automated tests
scripts/       Maintenance and development utilities
```

## AI prompt source

```text
ai/prompt-registry/tools/   Individual educational-tool prompts
ai/prompt-engine/shared/   Shared teaching and curriculum instructions
ai/prompt-versioning/      Versioned prompt assembly
ai/providers/              Provider calls and model routing
```

Some files under `prompts/` are compatibility re-exports pointing to these source folders.

## Local development

Install Node.js and npm and use a development MongoDB database. Configure a local `.env` with the settings required by `config/` and the features you intend to use. The existing `.env.example` is only a partial example, not a complete configuration reference.

```bash
npm ci
npm run dev
```

Keep database credentials, signing secrets and provider keys out of source control. AI and payment features require their corresponding configured services. Use development credentials and data when testing.

## Commands

```bash
npm start                 # Run the main application
npm run dev               # Run with automatic reload
npm run test:auth         # Authentication tests
npm run test:ai-layout    # AI layout tests
npm test                  # Configured maturity test suite
```

Review individual test and utility files before running them; some require services or modify data. There is no backend compilation step.

## Related code

[AsliLearn Frontend](https://github.com/aslilearnai-hyd/Aslilearn-frontend) contains the web interface.
