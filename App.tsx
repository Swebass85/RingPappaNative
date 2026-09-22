import React, { useEffect, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  mediaDevices,
  MediaStream,
  RTCView,
} from 'react-native-webrtc';

function App() {
  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [cameraStarted, setCameraStarted] =
    useState(false);

  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach(track => {
        track.stop();
      });
    };
  }, [localStream]);

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      const cameraAlreadyGranted =
        await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );

      const microphoneAlreadyGranted =
        await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );

      if (
        cameraAlreadyGranted &&
        microphoneAlreadyGranted
      ) {
        return true;
      }

      const cameraPermission =
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );

      if (
        cameraPermission !==
        PermissionsAndroid.RESULTS.GRANTED
      ) {
        console.log('Camera permission denied.');
        return false;
      }

      const microphonePermission =
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );

      if (
        microphonePermission !==
        PermissionsAndroid.RESULTS.GRANTED
      ) {
        console.log('Microphone permission denied.');
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        'Permission request failed:',
        error,
      );

      return false;
    }
  };

  const startCamera = async () => {
    try {
      const hasPermission =
        await requestPermissions();

      if (!hasPermission) {
        console.log(
          'Camera or microphone permission was not granted.',
        );

        return;
      }

      const stream =
        await mediaDevices.getUserMedia({
          audio: true,

          video: {
            facingMode: 'user',
            width: 640,
            height: 480,
            frameRate: 30,
          },
        });

      setLocalStream(stream);
      setCameraStarted(true);
    } catch (error) {
      console.error(
        'Could not start camera:',
        error,
      );
    }
  };

  const stopCamera = () => {
    localStream?.getTracks().forEach(track => {
      track.stop();
    });

    setLocalStream(null);
    setCameraStarted(false);
  };

  if (cameraStarted && localStream) {
    return (
      <View style={styles.videoScreen}>
        <StatusBar hidden />

        <RTCView
          streamURL={localStream.toURL()}
          style={styles.video}
          objectFit="cover"
          mirror
        />

        <View style={styles.videoOverlay}>
          <Text style={styles.callingText}>
            PAPPA ❤️
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.endButton,
              pressed &&
                styles.endButtonPressed,
            ]}
            onPress={stopCamera}
          >
            <Text style={styles.endButtonIcon}>
              ✕
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#fff0f5"
      />

      <View style={styles.content}>
        <Text style={styles.emoji}>
          👨‍👧
        </Text>

        <Text style={styles.title}>
          PAPPA ❤️
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.callButton,
            pressed &&
              styles.callButtonPressed,
          ]}
          onPress={startCamera}
        >
          <Text style={styles.camera}>
            📹
          </Text>

          <Text style={styles.buttonText}>
            RING PAPPA
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff0f5',
  },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  emoji: {
    fontSize: 90,
    marginBottom: 12,
  },

  title: {
    fontSize: 46,
    fontWeight: '900',
    color: '#2d1b24',
    marginBottom: 50,
    textAlign: 'center',
  },

  callButton: {
    width: '90%',
    maxWidth: 500,
    minHeight: 180,
    backgroundColor: '#ff4f8b',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    elevation: 8,
  },

  callButtonPressed: {
    transform: [
      {
        scale: 0.96,
      },
    ],
    opacity: 0.9,
  },

  camera: {
    fontSize: 58,
    marginBottom: 10,
  },

  buttonText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
  },

  videoScreen: {
    flex: 1,
    backgroundColor: '#000000',
  },

  video: {
    flex: 1,
  },

  videoOverlay: {
    position: 'absolute',
    top: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  callingText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },

  endButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },

  endButtonPressed: {
    transform: [
      {
        scale: 0.9,
      },
    ],
    opacity: 0.85,
  },

  endButtonIcon: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
  },
});

export default App;