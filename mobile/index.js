// App entry: Expo Router, plus the Android widget's background handler
// (it must be registered here so it also runs while the app is closed).
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './src/widgets/task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
