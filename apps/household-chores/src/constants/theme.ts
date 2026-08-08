import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

const brandColors = {
  primary: '#208AEF',
  secondary: '#5FA8F5',
};

export const paperLightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: brandColors.primary,
    secondary: brandColors.secondary,
  },
};

export const paperDarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brandColors.primary,
    secondary: brandColors.secondary,
  },
};
