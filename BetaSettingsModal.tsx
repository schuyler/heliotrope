/**
 * Modal component for adjusting AHRS beta parameter
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import WheelPicker from '@quidone/react-native-wheel-picker';
import { generateBetaValues, MIN_BETA, MAX_BETA } from './beta-storage';

type Props = {
  visible: boolean;
  currentBeta: number;
  onClose: () => void;
  onBetaChange: (beta: number) => void;
};

export function BetaSettingsModal({ visible, currentBeta, onClose, onBetaChange }: Props) {
  const [manualInput, setManualInput] = useState<string>('');
  const [selectedBeta, setSelectedBeta] = useState<number>(currentBeta);
  const betaValues = generateBetaValues();

  // Sync selected beta when modal opens
  useEffect(() => {
    if (visible) {
      setSelectedBeta(currentBeta);
      setManualInput('');
    }
  }, [visible, currentBeta]);

  const handleApply = () => {
    onBetaChange(selectedBeta);
    onClose();
  };

  const handleManualSubmit = () => {
    const parsed = parseFloat(manualInput);
    if (Number.isFinite(parsed) && parsed >= MIN_BETA && parsed <= MAX_BETA) {
      setSelectedBeta(Math.round(parsed * 100) / 100);
      setManualInput('');
    }
  };

  const pickerData = betaValues.map(v => ({
    value: v,
    label: v.toFixed(2),
  }));

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={modalStyles.overlay}
      >
        <View style={modalStyles.container}>
          <Text style={modalStyles.title}>AHRS Beta</Text>
          <Text style={modalStyles.description}>
            Lower = smoother, slower{'\n'}
            Higher = faster, noisier
          </Text>

          {/* Wheel Picker */}
          <View style={modalStyles.pickerContainer}>
            <WheelPicker
              data={pickerData}
              value={selectedBeta}
              onValueChanged={({ item }) => setSelectedBeta(item.value)}
              itemHeight={44}
              width={120}
            />
          </View>

          {/* Manual Input */}
          <View style={modalStyles.inputRow}>
            <TextInput
              style={modalStyles.textInput}
              keyboardType="decimal-pad"
              placeholder={`${MIN_BETA}-${MAX_BETA}`}
              placeholderTextColor="#666"
              value={manualInput}
              onChangeText={setManualInput}
              onSubmitEditing={handleManualSubmit}
            />
            <TouchableOpacity style={modalStyles.setButton} onPress={handleManualSubmit}>
              <Text style={modalStyles.setButtonText}>Set</Text>
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          <View style={modalStyles.buttonRow}>
            <TouchableOpacity style={modalStyles.cancelButton} onPress={onClose}>
              <Text style={modalStyles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modalStyles.applyButton} onPress={handleApply}>
              <Text style={modalStyles.buttonText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    maxWidth: 320,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'Baskerville',
    marginBottom: 8,
  },
  description: {
    color: '#aaa',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  pickerContainer: {
    height: 150,
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  textInput: {
    backgroundColor: '#333',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: 100,
    fontSize: 16,
    marginRight: 8,
  },
  setButton: {
    backgroundColor: '#444',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  setButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    backgroundColor: '#444',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  applyButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
