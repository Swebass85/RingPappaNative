import React, { useEffect, useRef, useState } from 'react';
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
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCView,
} from 'react-native-webrtc';

import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from '@react-native-firebase/auth';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from '@react-native-firebase/firestore';

const BACKEND_URL =
  'https://ring-pappa-backend.vercel.app/api/ring-dad';

function App() {
  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] =
    useState<MediaStream | null>(null);

  const [cameraStarted, setCameraStarted] =
    useState(false);

  const [firebaseReady, setFirebaseReady] =
    useState(false);

  const [firebaseError, setFirebaseError] =
    useState<string | null>(null);

  const [callStatus, setCallStatus] =
    useState('');

  const peerConnectionRef =
    useRef<RTCPeerConnection | null>(null);

  const localStreamRef =
    useRef<MediaStream | null>(null);

  const remoteStreamRef =
    useRef<MediaStream | null>(null);

  const callIdRef =
    useRef<string | null>(null);

  const unsubscribeCallRef =
    useRef<(() => void) | null>(null);

  const unsubscribeAnswerCandidatesRef =
    useRef<(() => void) | null>(null);

  /*
   * Firebase anonymous authentication.
   */
  useEffect(() => {
    const auth = getAuth();

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async user => {
          if (user) {
            console.log(
              'Firebase authenticated. UID:',
              user.uid,
            );

            setFirebaseReady(true);
            setFirebaseError(null);

            return;
          }

          try {
            console.log(
              'Signing into Firebase anonymously...',
            );

            await signInAnonymously(auth);
          } catch (error) {
            console.error(
              'Firebase anonymous authentication failed:',
              error,
            );

            setFirebaseReady(false);

            setFirebaseError(
              'Firebase connection failed',
            );
          }
        },
      );

    return unsubscribe;
  }, []);

  /*
   * Cleanup only when the whole App unmounts.
   */
  useEffect(() => {
    return () => {
      console.log(
        'App unmounting - cleaning up WebRTC.',
      );

      unsubscribeCallRef.current?.();
      unsubscribeCallRef.current = null;

      unsubscribeAnswerCandidatesRef.current?.();
      unsubscribeAnswerCandidatesRef.current =
        null;

      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;

      localStreamRef.current
        ?.getTracks()
        .forEach(track => {
          track.stop();
        });

      localStreamRef.current = null;

      remoteStreamRef.current
        ?.getTracks()
        .forEach(track => {
          track.stop();
        });

      remoteStreamRef.current = null;
    };
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      const cameraGranted =
        await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );

      const microphoneGranted =
        await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );

      if (
        cameraGranted &&
        microphoneGranted
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
        return false;
      }

      const microphonePermission =
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );

      return (
        microphonePermission ===
        PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (error) {
      console.error(
        'Permission request failed:',
        error,
      );

      return false;
    }
  };

  const sendCallNotification = async (
    callId: string,
  ) => {
    console.log(
      'Sending call notification:',
      callId,
    );

    const response = await fetch(
      BACKEND_URL,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body: JSON.stringify({
          callId,
        }),
      },
    );

    if (!response.ok) {
      const responseText =
        await response.text();

      throw new Error(
        `Notification failed: ${response.status} ${responseText}`,
      );
    }

    const result =
      await response.json();

    console.log(
      'Notification sent:',
      result,
    );
  };

  const stopLocalMedia = () => {
    localStreamRef.current
      ?.getTracks()
      .forEach(track => {
        track.stop();
      });

    localStreamRef.current = null;

    setLocalStream(null);
    setCameraStarted(false);
  };

  const stopRemoteMedia = () => {
    remoteStreamRef.current
      ?.getTracks()
      .forEach(track => {
        track.stop();
      });

    remoteStreamRef.current = null;
    setRemoteStream(null);
  };

  const stopCall = async () => {
    console.log(
      'Stopping call...',
    );

    unsubscribeCallRef.current?.();
    unsubscribeCallRef.current = null;

    unsubscribeAnswerCandidatesRef.current?.();
    unsubscribeAnswerCandidatesRef.current =
      null;

    if (peerConnectionRef.current) {
      console.log(
        'Closing peer connection.',
      );

      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const callId =
      callIdRef.current;

    callIdRef.current = null;

    stopRemoteMedia();
    stopLocalMedia();

    setCallStatus('');

    if (callId) {
      try {
        const db =
          getFirestore();

        await deleteDoc(
          doc(
            db,
            'calls',
            callId,
          ),
        );

        console.log(
          'Call deleted:',
          callId,
        );
      } catch (error) {
        console.log(
          'Could not remove call document:',
          error,
        );
      }
    }
  };

  const startCall = async () => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        console.log(
          'Firebase user is not ready.',
        );

        return;
      }

      /*
       * Make sure an old connection cannot
       * interfere with a new call.
       */
      if (peerConnectionRef.current) {
        console.log(
          'Closing previous peer connection.',
        );

        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      unsubscribeCallRef.current?.();
      unsubscribeCallRef.current = null;

      unsubscribeAnswerCandidatesRef.current?.();
      unsubscribeAnswerCandidatesRef.current =
        null;

      stopRemoteMedia();

      setCallStatus(
        'Startar samtal...',
      );

      const hasPermission =
        await requestPermissions();

      if (!hasPermission) {
        setCallStatus(
          'Kamera eller mikrofon saknar behörighet',
        );

        return;
      }

      console.log(
        'Opening camera and microphone...',
      );

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

      localStreamRef.current =
        stream;

      setLocalStream(stream);
      setCameraStarted(true);

      console.log(
        'Local media ready.',
      );

      /*
       * Create WebRTC connection.
       */
      const peerConnection =
        new RTCPeerConnection({
          iceServers: [
            {
              urls:
                'stun:stun.l.google.com:19302',
            },
          ],
        });

      peerConnectionRef.current =
        peerConnection;

      console.log(
        'Peer connection created.',
      );

      /*
       * Receive Dad's camera + microphone.
       */
      peerConnection.ontrack =
        event => {
          console.log(
            'Remote track received from Dad:',
            event.track.kind,
          );

          let dadStream =
            remoteStreamRef.current;

          if (!dadStream) {
            dadStream =
              new MediaStream();

            remoteStreamRef.current =
              dadStream;
          }

          const alreadyAdded =
            dadStream
              .getTracks()
              .some(
                track =>
                  track.id ===
                  event.track.id,
              );

          if (!alreadyAdded) {
            dadStream.addTrack(
              event.track,
            );
          }

          setRemoteStream(
            new MediaStream(
              dadStream.getTracks(),
            ),
          );
        };

      /*
       * Connection state logging.
       */
      peerConnection.onconnectionstatechange =
        () => {
          console.log(
            'WebRTC connection state:',
            peerConnection.connectionState,
          );

          if (
            peerConnection.connectionState ===
            'connected'
          ) {
            setCallStatus(
              'Ansluten till pappa ❤️',
            );
          }

          if (
            peerConnection.connectionState ===
              'failed' ||
            peerConnection.connectionState ===
              'disconnected'
          ) {
            setCallStatus(
              'Anslutningen bröts',
            );
          }
        };

      peerConnection.oniceconnectionstatechange =
        () => {
          console.log(
            'ICE connection state:',
            peerConnection.iceConnectionState,
          );
        };

      peerConnection.onicegatheringstatechange =
        () => {
          console.log(
            'ICE gathering state:',
            peerConnection.iceGatheringState,
          );
        };

      /*
       * Add daughter's camera + microphone.
       */
      stream
        .getTracks()
        .forEach(track => {
          console.log(
            'Adding local track:',
            track.kind,
          );

          peerConnection.addTrack(
            track,
            stream,
          );
        });

      const db =
        getFirestore();

      const callReference =
        doc(
          collection(
            db,
            'calls',
          ),
        );

      const callId =
        callReference.id;

      callIdRef.current =
        callId;

      console.log(
        'Generated call ID:',
        callId,
      );

      /*
       * Daughter's ICE candidates.
       */
      const callerCandidates =
        collection(
          callReference,
          'callerCandidates',
        );

      peerConnection.onicecandidate =
        async (event: any) => {
          if (!event.candidate) {
            console.log(
              'ICE candidate gathering complete.',
            );

            return;
          }

          console.log(
            'Local ICE candidate generated.',
          );

          try {
            await addDoc(
              callerCandidates,
              event.candidate.toJSON(),
            );

            console.log(
              'Caller ICE candidate saved.',
            );
          } catch (error) {
            console.error(
              'Could not save ICE candidate:',
              error,
            );
          }
        };

      /*
       * Create daughter's WebRTC offer.
       */
      console.log(
        'Creating WebRTC offer...',
      );

      const offer =
        await peerConnection.createOffer();

      console.log(
        'Offer created.',
      );

      await peerConnection.setLocalDescription(
        offer,
      );

      console.log(
        'Local description set.',
      );

      /*
       * Create Firestore call.
       */
      await setDoc(
        callReference,
        {
          callerId: user.uid,

          answererId: null,

          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },

          status: 'ringing',

          createdAt:
            serverTimestamp(),
        },
      );

      console.log(
        'Call created:',
        callId,
      );

      setCallStatus(
        'Ringer pappa...',
      );

      /*
       * Send Dad's notification.
       */
      try {
        await sendCallNotification(
          callId,
        );

        console.log(
          'Dad notification sent successfully.',
        );
      } catch (notificationError) {
        console.error(
          'Could not notify Dad:',
          notificationError,
        );

        setCallStatus(
          'Samtalet startade, men notisen kunde inte skickas',
        );
      }

      /*
       * Listen for Dad's WebRTC answer.
       */
      console.log(
        'Listening for Dad answer...',
      );

      unsubscribeCallRef.current =
        onSnapshot(
          callReference,
          async snapshot => {
            if (!snapshot.exists()) {
              console.log(
                'Call document no longer exists.',
              );

              return;
            }

            const data =
              snapshot.data();

            console.log(
              'Call document updated. Status:',
              data?.status,
            );

            if (
              data?.answer &&
              !peerConnection.remoteDescription
            ) {
              console.log(
                'Answer received from Dad.',
              );

              try {
                const answer =
                  new RTCSessionDescription(
                    data.answer,
                  );

                console.log(
                  'Setting remote description...',
                );

                await peerConnection.setRemoteDescription(
                  answer,
                );

                console.log(
                  'Remote description set successfully.',
                );

                setCallStatus(
                  'Pappa svarade ❤️',
                );
              } catch (error) {
                console.error(
                  'Could not set Dad remote description:',
                  error,
                );
              }
            }

            if (
              data?.status ===
              'ended'
            ) {
              console.log(
                'Dad ended the call.',
              );

              await stopCall();
            }
          },
          error => {
            console.error(
              'Call listener error:',
              error,
            );
          },
        );

      /*
       * Listen for Dad's ICE candidates.
       */
      const answerCandidates =
        collection(
          callReference,
          'answerCandidates',
        );

      console.log(
        'Listening for Dad ICE candidates...',
      );

      unsubscribeAnswerCandidatesRef.current =
        onSnapshot(
          answerCandidates,
          snapshot => {
            snapshot
              .docChanges()
              .forEach(
                async change => {
                  if (
                    change.type !==
                    'added'
                  ) {
                    return;
                  }

                  console.log(
                    'Dad ICE candidate received.',
                  );

                  try {
                    const candidate =
                      new RTCIceCandidate(
                        change.doc.data(),
                      );

                    await peerConnection.addIceCandidate(
                      candidate,
                    );

                    console.log(
                      'Dad ICE candidate added.',
                    );
                  } catch (error) {
                    console.error(
                      'Could not add answer ICE candidate:',
                      error,
                    );
                  }
                },
              );
          },
          error => {
            console.error(
              'Answer candidate listener error:',
              error,
            );
          },
        );
    } catch (error) {
      console.error(
        'Could not start call:',
        error,
      );

      setCallStatus(
        'Kunde inte starta samtalet',
      );

      stopRemoteMedia();
      stopLocalMedia();
    }
  };

  /*
   * Active video call screen.
   *
   * Waiting:
   * Daughter is full-screen.
   *
   * Connected:
   * Dad is full-screen.
   * Daughter is picture-in-picture.
   */
  if (
    cameraStarted &&
    localStream
  ) {
    return (
      <View
        style={
          styles.videoScreen
        }
      >
        <StatusBar hidden />

        {remoteStream ? (
          <>
            <RTCView
              streamURL={
                remoteStream.toURL()
              }
              style={styles.video}
              objectFit="cover"
            />

            <View
              style={
                styles.localPreviewContainer
              }
            >
              <RTCView
                streamURL={
                  localStream.toURL()
                }
                style={
                  styles.localPreview
                }
                objectFit="cover"
                mirror
              />
            </View>
          </>
        ) : (
          <RTCView
            streamURL={
              localStream.toURL()
            }
            style={styles.video}
            objectFit="cover"
            mirror
          />
        )}

        <View
          style={
            styles.callHeader
          }
        >
          <Text
            style={
              styles.callingText
            }
          >
            PAPPA ❤️
          </Text>

          <Text
            style={
              styles.callStatus
            }
          >
            {callStatus}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.endButton,
            styles.endButtonPosition,

            pressed &&
              styles.endButtonPressed,
          ]}
          onPress={stopCall}
        >
          <Text
            style={
              styles.endButtonIcon
            }
          >
            ✕
          </Text>
        </Pressable>
      </View>
    );
  }

  /*
   * Home screen.
   */
  return (
    <SafeAreaView
      style={styles.container}
    >
      <StatusBar
        barStyle="dark-content"
      />

      <View
        style={styles.content}
      >
        <Text
          style={styles.emoji}
        >
          👨‍👧
        </Text>

        <Text
          style={styles.title}
        >
          PAPPA ❤️
        </Text>

        <Pressable
          disabled={!firebaseReady}
          style={({ pressed }) => [
            styles.callButton,

            !firebaseReady &&
              styles.callButtonDisabled,

            pressed &&
              firebaseReady &&
              styles.callButtonPressed,
          ]}
          onPress={startCall}
        >
          <Text
            style={styles.camera}
          >
            📹
          </Text>

          <Text
            style={
              styles.buttonText
            }
          >
            {firebaseReady
              ? 'RING PAPPA'
              : 'STARTAR...'}
          </Text>
        </Pressable>

        {firebaseReady && (
          <Text
            style={
              styles.firebaseStatus
            }
          >
            ✓ Redo
          </Text>
        )}

        {firebaseError && (
          <Text
            style={
              styles.errorText
            }
          >
            {firebaseError}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#fff0f5',
    },

    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor:
        '#fff0f5',
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
      backgroundColor:
        '#ff4f8b',
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 28,
      paddingHorizontal: 20,
      elevation: 8,
    },

    callButtonDisabled: {
      opacity: 0.55,
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

    firebaseStatus: {
      marginTop: 18,
      color: '#248a3d',
      fontSize: 16,
      fontWeight: '700',
    },

    errorText: {
      marginTop: 18,
      color: '#c62828',
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
    },

    videoScreen: {
      flex: 1,
      backgroundColor:
        '#000000',
    },

    video: {
      flex: 1,
    },

    /*
     * PAPPA + connection status.
     */
    callHeader: {
      position: 'absolute',
      top: 30,
      left: 20,
      zIndex: 20,
    },

    callingText: {
      color: '#ffffff',
      fontSize: 28,
      fontWeight: '900',
    },

    callStatus: {
      color: '#ffffff',
      fontSize: 17,
      fontWeight: '700',
      marginTop: 5,
    },

    /*
     * Daughter's small camera preview.
     */
    localPreviewContainer: {
      position: 'absolute',
      top: 25,
      right: 20,
      width: 150,
      height: 200,
      borderRadius: 20,
      overflow: 'hidden',
      backgroundColor:
        '#222222',
      borderWidth: 3,
      borderColor:
        '#ffffff',
      elevation: 10,
      zIndex: 30,
    },

    localPreview: {
      width: '100%',
      height: '100%',
    },

    /*
     * Hang-up button.
     */
    endButton: {
      width: 70,
      height: 70,
      borderRadius: 35,
      backgroundColor:
        '#ff3b30',
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
    },

    endButtonPosition: {
      position: 'absolute',
      bottom: 30,
      left: '50%',
      marginLeft: -35,
      zIndex: 40,
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