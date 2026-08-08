import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Button, Muted } from '@couple/ui';
import { View } from 'react-native';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.8,
  allowsEditing: true,
  aspect: [4, 3],
};

/** Downscale/compress before upload so proof photos don't bloat storage. */
async function compress(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1280 });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return result.uri;
}

export function PhotoCapture({
  uri,
  onChange,
}: {
  uri: string | null;
  onChange: (uri: string | null) => void;
}) {
  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (!result.canceled) onChange(await compress(result.assets[0].uri));
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (!result.canceled) onChange(await compress(result.assets[0].uri));
  };

  return (
    <View className="gap-3">
      {uri ? (
        <Image source={{ uri }} className="w-full rounded-xl" style={{ aspectRatio: 4 / 3 }} />
      ) : (
        <View
          className="w-full items-center justify-center rounded-xl border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
          style={{ aspectRatio: 4 / 3 }}
        >
          <Muted>No photo yet</Muted>
        </View>
      )}

      <View className="flex-row gap-3">
        <View className="grow basis-0">
          <Button label="Camera" variant="secondary" onPress={pickFromCamera} />
        </View>
        <View className="grow basis-0">
          <Button label="Library" variant="secondary" onPress={pickFromLibrary} />
        </View>
      </View>

      {uri ? <Button label="Remove photo" variant="danger" onPress={() => onChange(null)} /> : null}
    </View>
  );
}
