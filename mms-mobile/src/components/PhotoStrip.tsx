// src/components/PhotoStrip.tsx
//
// Reusable photo capture and display strip.
// Used in NewWorkOrderScreen (photos attached at creation) and
// WorkOrderDetailScreen (photos added to an existing WO).
//
// Offline behaviour:
//   - Photos are saved to expo-file-system immediately on capture.
//   - Each photo is represented as a PhotoItem with a local_uri.
//   - When a woId is provided and the device is online, upload happens
//     immediately. Otherwise the caller is responsible for queuing via
//     the outbox (see usePhotoUpload hook).
//
// Props:
//   photos        — controlled list of PhotoItems
//   onAdd         — called after camera/library produces a new local photo
//   onRemove      — called when the user deletes a photo
//   maxPhotos     — default 10
//   disabled      — hides the add button (e.g. WO is completed)

import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, Pressable, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { generateUUID } from '@/utils/uuid';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PhotoItem {
  id: string;
  local_uri: string;       // always present — expo-file-system permanent path
  server_url: string | null; // null until synced
  is_pending_sync: boolean;
  captured_at: string;     // ISO
}

interface PhotoStripProps {
  photos: PhotoItem[];
  onAdd: (photo: PhotoItem) => void;
  onRemove: (id: string) => void;
  maxPhotos?: number;
  disabled?: boolean;
  label?: string;
}

// ── Photo directory ───────────────────────────────────────────────────────────

const PHOTO_DIR = `${FileSystem.documentDirectory}wo_photos/`;

async function ensurePhotoDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
}

async function savePhotoLocally(sourceUri: string): Promise<string> {
  await ensurePhotoDir();
  const ext  = sourceUri.split('.').pop()?.split('?')[0] ?? 'jpg';
  const dest = `${PHOTO_DIR}${generateUUID()}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PhotoStrip({
  photos,
  onAdd,
  onRemove,
  maxPhotos = 10,
  disabled = false,
  label = 'PHOTOS',
}: PhotoStripProps) {
  const [picking,   setPicking]   = useState(false);
  const [lightbox,  setLightbox]  = useState<PhotoItem | null>(null);

  const canAdd = !disabled && photos.length < maxPhotos;

  async function handleAdd(source: 'camera' | 'library') {
    setPicking(true);
    try {
      let result: ImagePicker.ImagePickerResult;

      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission required', 'Camera access is needed to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
          allowsEditing: false,
        });
      } else {
        // Android 13+ (API 33+) uses READ_MEDIA_IMAGES instead of
        // READ_EXTERNAL_STORAGE. expo-media-library handles this correctly;
        // expo-image-picker's own requestMediaLibraryPermissionsAsync only
        // covers the legacy permission on older Android versions.
        if (Platform.OS === 'android') {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(
              'Permission required',
              'Storage access is needed to select photos from your device.',
              [{ text: 'OK' }]
            );
            return;
          }
        } else {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission required', 'Photo library access is needed.');
            return;
          }
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
          allowsMultipleSelection: false,
        });
      }

      if (result.canceled || !result.assets?.[0]) return;

      const asset    = result.assets[0];
      const localUri = await savePhotoLocally(asset.uri);

      onAdd({
        id:              generateUUID(),
        local_uri:       localUri,
        server_url:      null,
        is_pending_sync: true,
        captured_at:     new Date().toISOString(),
      });
    } catch (e) {
      Alert.alert('Error', 'Could not capture photo. Please try again.');
    } finally {
      setPicking(false);
    }
  }

  function confirmRemove(photo: PhotoItem) {
    Alert.alert(
      'Remove photo',
      'Remove this photo from the work order?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: () => {
            // Best-effort delete from filesystem
            FileSystem.deleteAsync(photo.local_uri, { idempotent: true }).catch(() => {});
            onRemove(photo.id);
          },
        },
      ]
    );
  }

  function handleSourcePicker() {
    Alert.alert(
      'Add photo',
      '',
      [
        { text: 'Take photo',        onPress: () => handleAdd('camera') },
        { text: 'Choose from library', onPress: () => handleAdd('library') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <View style={s.root}>
      <Text style={s.label}>{label}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
      >
        {/* Add button */}
        {canAdd && (
          <TouchableOpacity
            style={s.addBtn}
            onPress={handleSourcePicker}
            activeOpacity={0.7}
            disabled={picking}
          >
            {picking
              ? <ActivityIndicator color="#f0a500" size="small" />
              : <>
                  <Text style={s.addIcon}>+</Text>
                  <Text style={s.addText}>ADD{'\n'}PHOTO</Text>
                </>
            }
          </TouchableOpacity>
        )}

        {/* Thumbnails */}
        {photos.map(photo => (
          <TouchableOpacity
            key={photo.id}
            style={s.thumb}
            onPress={() => setLightbox(photo)}
            onLongPress={() => confirmRemove(photo)}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: photo.local_uri }}
              style={s.thumbImg}
              resizeMode="cover"
            />
            {photo.is_pending_sync && (
              <View style={s.syncDot}>
                <Text style={s.syncDotText}>↑</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}

        {photos.length === 0 && !canAdd && (
          <Text style={s.empty}>No photos</Text>
        )}
      </ScrollView>

      {photos.length > 0 && (
        <Text style={s.hint}>Tap to view · Long press to remove</Text>
      )}

      {/* Lightbox */}
      <Modal
        visible={!!lightbox}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <Pressable style={s.lightboxOverlay} onPress={() => setLightbox(null)}>
          {lightbox && (
            <View style={s.lightboxContent}>
              <Image
                source={{ uri: lightbox.local_uri }}
                style={s.lightboxImg}
                resizeMode="contain"
              />
              <View style={s.lightboxMeta}>
                {lightbox.is_pending_sync && (
                  <Text style={s.lightboxPending}>↑ Pending upload</Text>
                )}
                <TouchableOpacity
                  onPress={() => { setLightbox(null); confirmRemove(lightbox); }}
                  style={s.lightboxRemoveBtn}
                >
                  <Text style={s.lightboxRemoveText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const THUMB_SIZE = 80;

const s = StyleSheet.create({
  root:              { marginBottom: 20 },
  label:             { fontSize: 9, letterSpacing: 1.4, color: '#555', fontFamily: 'monospace', marginBottom: 8, paddingHorizontal: 18 },
  strip:             { paddingHorizontal: 18, gap: 8, flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },

  addBtn:            { width: THUMB_SIZE, height: THUMB_SIZE, borderWidth: 1, borderColor: '#f0a50066', borderRadius: 4, borderStyle: 'dashed', backgroundColor: '#1a1a1e', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addIcon:           { fontSize: 20, color: '#f0a500', fontFamily: 'monospace', lineHeight: 22 },
  addText:           { fontSize: 8, color: '#f0a50099', fontFamily: 'monospace', letterSpacing: 0.8, textAlign: 'center', lineHeight: 11 },

  thumb:             { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: '#2a2a30' },
  thumbImg:          { width: '100%', height: '100%' },
  syncDot:           { position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: '#f0a500', alignItems: 'center', justifyContent: 'center' },
  syncDotText:       { fontSize: 9, color: '#0d0d0f', fontWeight: '700' },

  empty:             { fontSize: 11, color: '#333', fontFamily: 'monospace', paddingVertical: 28 },
  hint:              { fontSize: 9, color: '#333', fontFamily: 'monospace', letterSpacing: 0.6, paddingHorizontal: 18, marginTop: 6 },

  lightboxOverlay:   { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', alignItems: 'center' },
  lightboxContent:   { width: '90%', maxHeight: '80%', alignItems: 'center', gap: 12 },
  lightboxImg:       { width: '100%', aspectRatio: 1, borderRadius: 6 },
  lightboxMeta:      { flexDirection: 'row', alignItems: 'center', gap: 16 },
  lightboxPending:   { fontSize: 11, color: '#f0a500', fontFamily: 'monospace' },
  lightboxRemoveBtn: { borderWidth: 1, borderColor: '#ff4444', borderRadius: 3, paddingHorizontal: 14, paddingVertical: 7 },
  lightboxRemoveText:{ fontSize: 11, color: '#ff4444', fontFamily: 'monospace', letterSpacing: 0.8 },
});
