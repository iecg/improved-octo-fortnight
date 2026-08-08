import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

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
    <View style={styles.container}>
      {uri ? (
        <Image source={{ uri }} style={styles.preview} contentFit="cover" />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No photo yet</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <Button mode="outlined" icon="camera" onPress={pickFromCamera} style={styles.button}>
          Camera
        </Button>
        <Button mode="outlined" icon="image" onPress={pickFromLibrary} style={styles.button}>
          Library
        </Button>
      </View>

      {uri ? (
        <Button onPress={() => onChange(null)} textColor="#B3261E">
          Remove photo
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  placeholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: 'rgba(128,128,128,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { opacity: 0.6 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  button: { flex: 1 },
});
