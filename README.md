# Forge Template (TypeScript)

This template provides a complete Forge app setup with TypeScript, Jest testing, ESLint, and modern development tooling. It serves as a foundation for building more complex Forge applications.

## Quick Start

### Prerequisites

- Node.js 20+
- Forge CLI installed (`npm install -g @forge/cli`)

### Get Started

1. **Install dependencies:**

   ```bash
   npm install
   ```
   Note: The override in the package.json "@atlaskit/tokens" forces transitive dependencies on @atlaskit/tokens to resolve to one version, preventing npm from creating many versions and increasing the app size.
  }

2. **Validate your setup:**

   ```bash
   npm run ci  # Runs TypeScript check + linting + tests
   ```

3. **Deploy and install:**

   ```bash
   # Deploy to Atlassian's infrastructure
   forge deploy

   # Install to your development site
   forge install
   ```

## Forge UI Kit Types

This template includes TypeScript definitions for Forge UI Kit components to enable type safety.

### Quick Start

```typescript
import { ButtonProps, BoxProps, ModalProps } from '../types';

// Type-safe component props
const MyButton: React.FC<ButtonProps> = (props) => {
  return <Button {...props} />;
};

// With custom styling using xcss
import { xcss } from '../types';

const containerStyles = xcss({
  padding: 'space.200',
  backgroundColor: 'color.background.neutral',
});

const MyContainer: React.FC<BoxProps> = (props) => {
  return <Box xcss={containerStyles} {...props} />;
};
```

## Template Structure

```
src/
├── index.ts              # Main entry point and resolver exports
├── resolvers/            # Backend resolver functions
│   ├── index.ts          # Sample resolver implementation
│   └── __tests__/        # Resolver tests
├── frontend/             # React frontend
│   ├── index.tsx         # Sample UI Kit components
│   └── __tests__/        # Component tests
└── setupTests.ts         # Jest test configuration
```

## 🔧 Development Commands

```bash
npm run type-check    # TypeScript compilation check
npm run lint          # ESLint for code quality
npm run lint:fix      # Auto-fix linting issues
npm run test          # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run ci            # Complete validation (recommended before deployment)
```

## Modifying This Template

- **Frontend Changes**: Edit `src/frontend/index.tsx` for UI modifications
- **Backend Logic**: Edit `src/resolvers/index.ts` for resolver functions
- **Add Features**: Follow the architecture patterns shown in the development guides
- **Testing**: Add tests in `__tests__/` folders next to your code

## Learn More

- [Forge Documentation](https://developer.atlassian.com/platform/forge/)
- Use the comprehensive guides linked above for detailed development patterns
