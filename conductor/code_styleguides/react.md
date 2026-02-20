# React Style Guide

- **Components:** Functional components only with React Hooks.
- **State Management:** Prioritize local component state. Use Context or external stores (like Redux/Zustand) for global state sparingly.
- **Hooks:** Create custom hooks for reusable logic and data fetching.
- **Props:** Use TypeScript interfaces for prop definitions. Avoid `any`.
- **Styling:** Modular CSS or styled-components. Favor responsive design for desktop-first application.
- **File Structure:** Co-locate component logic, types, and styles in the same directory.
- **Modularity:** Design components as "LEGO blocks" for future extensibility and reusability.
