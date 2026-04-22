#!/usr/bin/env python3
"""
Muse 2 EEG to MIDI Converter usando OSC
Requiere: pip install python-osc midiutil matplotlib
"""

import time
import numpy as np
import threading
import socket
import json
from pathlib import Path
from midiutil import MIDIFile
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Backend sin interfaz gráfica para guardar archivos

from pythonosc.dispatcher import Dispatcher
from pythonosc import osc_server
from safe_json_storage import write_json_with_fallback


class MuseOSCToMidi:
    def __init__(self, output_file="muse_output.mid", osc_ip="0.0.0.0", osc_port=5000):
        self.output_file = output_file
        self.osc_ip = osc_ip
        self.osc_port = osc_port
        self.eeg_data = {i: [] for i in range(4)}
        self.timestamps = []
        self.sample_count = 0
        self.server = None
        self.server_thread = None
        self.running = False
        
    def eeg_handler(self, address, *args):
        """Maneja los mensajes OSC de EEG del Muse en tiempo real"""
        # Aceptar tanto /muse/eeg como /eeg
        if ("/muse/eeg" in address or "/eeg" in address) and self.running:
            # Los datos de EEG vienen como 4 valores flotantes (ignorar los NaN al final)
            if len(args) >= 4:
                self.sample_count += 1
                current_time = time.time()
                
                # Guardar datos de los 4 canales EEG (solo los primeros 4 valores)
                for channel in range(4):
                    # Verificar que el valor no sea NaN
                    if not np.isnan(args[channel]):
                        self.eeg_data[channel].append(args[channel])
                    else:
                        # Si es NaN, usar 0 como valor por defecto
                        self.eeg_data[channel].append(0.0)
                
                self.timestamps.append(current_time)
                
                # Mostrar datos en tiempo real cada 50 muestras para no saturar la consola
                if self.sample_count % 50 == 0:
                    print(f"📊 Muestras recibidas: {self.sample_count}")
                    print(f"   Última muestra: {[f'{v:.3f}' for v in args[:4]]}")
                    
                    # Mostrar estadísticas básicas cada 50 muestras
                    if self.sample_count >= 50:
                        for ch in range(4):
                            if self.eeg_data[ch]:
                                recent_data = self.eeg_data[ch][-50:]  # Últimas 50 muestras
                                data = np.array(recent_data)
                                print(f"   Canal {ch+1} (últimas 50): min={data.min():.3f}, max={data.max():.3f}, avg={data.mean():.3f}")
                    print()
                
                # Limitar el historial para evitar uso excesivo de memoria (mantener últimas 1000 muestras)
                if len(self.eeg_data[0]) > 1000:
                    for channel in range(4):
                        self.eeg_data[channel] = self.eeg_data[channel][-1000:]
                    self.timestamps = self.timestamps[-1000:]

    def debug_handler(self, address, *args):
        """Handler para debugging - captura TODOS los mensajes OSC"""
        print(f"🔍 OSC recibido: {address} -> {args}")
        
        # Si es un mensaje de EEG, procesarlo también (tanto /muse/eeg como /eeg)
        if ("/muse/eeg" in address or "/eeg" in address) and self.running:
            self.eeg_handler(address, *args)
    
    def test_network_connectivity(self):
        """Prueba la conectividad de red"""
        print("🔗 Probando conectividad de red...")
        
        try:
            # Verificar que el puerto esté disponible
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.bind((self.osc_ip, self.osc_port))
                print(f"✓ Puerto {self.osc_port} disponible en {self.osc_ip}")
        except OSError as e:
            print(f"❌ Error con puerto {self.osc_port}: {e}")
            return False
        
        # Verificar IPs locales
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        print(f"💻 IP local del sistema: {local_ip}")
        
        if local_ip != self.osc_ip:
            print(f"⚠️  ATENCIÓN: Tu IP local ({local_ip}) es diferente a la configurada ({self.osc_ip})")
            print("   Asegúrate de que la app del Muse use la IP correcta")
        
        return True

    def setup_osc_server(self):
        """Configura el servidor OSC para recibir datos del Muse"""
        print(f"🔍 Configurando servidor OSC en {self.osc_ip}:{self.osc_port}...")
        
        try:
            # Crear dispatcher para manejar mensajes OSC
            dispatcher = Dispatcher()
            
            # Mapear específicamente /muse/eeg y /eeg
            dispatcher.map("/muse/eeg", self.eeg_handler)
            dispatcher.map("/eeg", self.eeg_handler)
            
            # Mapear TODOS los mensajes para debugging
            dispatcher.map("*", self.debug_handler)
            
            # Crear servidor OSC usando ThreadingOSCUDPServer
            self.server = osc_server.ThreadingOSCUDPServer((self.osc_ip, self.osc_port), dispatcher)
            print(f"✓ Servidor OSC configurado en {self.osc_ip}:{self.osc_port}")
            print("🔍 Modo DEBUG activado - se mostrarán TODOS los mensajes OSC recibidos")
            
            return True
            
        except Exception as e:
            print(f"❌ Error configurando servidor OSC: {e}")
            raise
    
    def start_osc_server(self):
        """Inicia el servidor OSC en un hilo separado"""
        def run_server():
            try:
                print("🚀 Iniciando servidor OSC...")
                print(f"Servidor OSC escuchando en {self.server.server_address}")
                self.server.serve_forever()
            except Exception as e:
                print(f"❌ Error en servidor OSC: {e}")
        
        self.server_thread = threading.Thread(target=run_server, daemon=True)
        self.server_thread.start()
        time.sleep(0.5)  # Pequeña pausa para que arranque el servidor
    
    def map_eeg_to_midi_note(self, eeg_value, channel):
        """Mapea valor EEG directamente a nota MIDI sin procesamiento musical"""
        # Mapeo directo de EEG a rango MIDI completo (0-127)
        # Sin escalas musicales - conversión lineal directa
        
        # Usar el valor EEG tal como viene, sin clampear
        # Solo asegurar que esté en un rango válido para MIDI
        if eeg_value < 0:
            eeg_value = 0
        
        # Mapeo lineal directo a rango MIDI (21-108 para notas audibles)
        # Usar valor absoluto para manejar valores negativos
        abs_value = abs(eeg_value)
        
        # Escalado simple: dividir por un factor para que quepa en rango MIDI
        # Usar módulo para mantener en rango válido
        midi_note = int((abs_value % 87) + 21)  # Rango 21-108
        
        return midi_note
    
    def calculate_note_velocity(self, eeg_value):
        """Calcula la velocidad (volumen) directamente del valor EEG"""
        # Mapeo directo del valor EEG a velocidad MIDI (1-127)
        # Sin normalización - usar el valor tal como viene
        
        abs_value = abs(eeg_value)
        # Escalado simple para velocidad MIDI
        velocity = int((abs_value % 127) + 1)  # Rango 1-127
        
        return velocity
    
    def plot_eeg_waves(self, data_dict, timestamps, output_image=None, title="Ondas Cerebrales EEG"):
        """Genera una gráfica de las ondas cerebrales capturadas"""
        try:
            print(f"\n📊 Generando gráfica de ondas cerebrales...")
            
            # Crear figura con subplots para cada canal
            fig, axes = plt.subplots(4, 1, figsize=(14, 10))
            fig.suptitle(title, fontsize=16, fontweight='bold')
            
            # Colores para cada canal
            colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A']
            channel_names = ['Canal 1 (TP9)', 'Canal 2 (AF7)', 'Canal 3 (AF8)', 'Canal 4 (TP10)']
            
            # Calcular tiempo en segundos
            if len(timestamps) > 1:
                time_seconds = np.array(timestamps) - timestamps[0]
            else:
                # Si no hay timestamps, crear una línea de tiempo basada en el número de muestras
                duration = len(data_dict[0]) / 256.0 if len(data_dict[0]) > 0 else 1.0  # Asumiendo ~256 Hz
                time_seconds = np.linspace(0, duration, len(data_dict[0]))
            
            # Graficar cada canal
            for ch in range(4):
                if len(data_dict[ch]) > 0:
                    # Asegurar que timestamps y datos tienen la misma longitud
                    data = np.array(data_dict[ch])
                    if len(time_seconds) > len(data):
                        time_plot = time_seconds[:len(data)]
                    else:
                        time_plot = time_seconds
                        data = data[:len(time_seconds)]
                    
                    # Graficar la onda
                    axes[ch].plot(time_plot, data, color=colors[ch], linewidth=0.8, alpha=0.9)
                    axes[ch].set_ylabel('Amplitud (μV)', fontsize=10)
                    axes[ch].set_title(channel_names[ch], fontsize=11, fontweight='bold', color=colors[ch])
                    axes[ch].grid(True, alpha=0.3, linestyle='--')
                    axes[ch].set_xlim(time_plot[0] if len(time_plot) > 0 else 0, 
                                     time_plot[-1] if len(time_plot) > 0 else 10)
                    
                    # Calcular y mostrar estadísticas
                    mean_val = np.mean(data)
                    std_val = np.std(data)
                    axes[ch].axhline(y=mean_val, color=colors[ch], linestyle='--', 
                                    alpha=0.5, linewidth=1.5, label=f'Media: {mean_val:.2f}')
                    axes[ch].legend(loc='upper right', fontsize=8)
                    
                    # Ajustar límites Y para mejor visualización
                    y_min, y_max = data.min(), data.max()
                    y_range = y_max - y_min
                    axes[ch].set_ylim(y_min - y_range * 0.1, y_max + y_range * 0.1)
            
            # Etiqueta del eje X solo en el último subplot
            axes[3].set_xlabel('Tiempo (segundos)', fontsize=11, fontweight='bold')
            
            # Ajustar espaciado entre subplots
            plt.tight_layout(rect=[0, 0, 1, 0.96])
            
            # Guardar la imagen
            if output_image is None:
                import os
                script_dir = os.path.dirname(os.path.abspath(__file__))
                timestamp_str = time.strftime("%Y%m%d_%H%M%S")
                output_image = os.path.join(script_dir, f"eeg_waves_{timestamp_str}.png")
            
            plt.savefig(output_image, dpi=300, bbox_inches='tight')
            plt.close(fig)
            
            print(f"✅ Gráfica guardada exitosamente: {output_image}")
            return output_image
            
        except Exception as e:
            print(f"❌ Error generando gráfica: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def start_realtime_capture(self):
        """Inicia la captura en tiempo real de datos OSC"""
        print("📊 Iniciando captura en tiempo real...")
        print("💡 Datos EEG se mostrarán cada 50 muestras")
        print("⚠️  Presiona Ctrl+C para detener la captura\n")
        
        # Marcar que estamos ejecutando
        self.running = True
        
        try:
            # Probar conectividad de red primero
            if not self.test_network_connectivity():
                return
                
            # Configurar servidor OSC
            self.setup_osc_server()
            
            # Iniciar servidor OSC
            self.start_osc_server()
            
            print("✅ Sistema en funcionamiento - esperando datos OSC...")
            print("   Configura la app del Muse para enviar a 127.0.0.1:5000")
            print("   Incluye datos de EEG en el streaming OSC")
            print("\n🔍 DEBUGGING ACTIVADO:")
            print("   • Se mostrarán TODOS los mensajes OSC que lleguen")
            print("   • Verifica que llegue algún mensaje (aunque no sea EEG)")
            print("   • Si no llega nada, revisa la configuración de red\n")
            
            # Mantener el programa corriendo indefinidamente
            while self.running:
                try:
                    time.sleep(1)
                except KeyboardInterrupt:
                    print("\n🛑 Interrupción detectada - cerrando...")
                    break
                    
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.stop_capture()
    
    def stop_capture(self):
        """Detiene la captura y cierra el servidor"""
        print("\n⏹️  Deteniendo captura...")
        self.running = False
        
        if self.server:
            try:
                self.server.shutdown()
                print("✓ Servidor OSC cerrado")
            except:
                pass
        
        # Mostrar estadísticas finales
        if self.sample_count > 0:
            print(f"\n📊 ESTADÍSTICAS FINALES:")
            print(f"   • Total de muestras: {self.sample_count}")
            print(f"   • Canales activos: {sum(1 for ch in range(4) if len(self.eeg_data[ch]) > 0)}")
            
            for ch in range(4):
                if self.eeg_data[ch]:
                    data = np.array(self.eeg_data[ch])
                    print(f"   • Canal {ch+1}: min={data.min():.3f}, max={data.max():.3f}, avg={data.mean():.3f}")
        else:
            print("❌ No se recibieron datos durante la sesión")
    
    def capture_custom_duration_to_json(self, output_json=None, duration=None):
        """Captura datos EEG durante la duración especificada y los guarda en JSON"""
        
        # Pedir duración si no se especifica
        if duration is None:
            while True:
                try:
                    duration_input = input("⏱️  Ingresa la duración de captura en segundos (ej: 10, 30, 60): ").strip()
                    duration = float(duration_input)
                    if duration > 0:
                        break
                    else:
                        print("❌ La duración debe ser mayor a 0")
                except ValueError:
                    print("❌ Por favor ingresa un número válido")
                except KeyboardInterrupt:
                    print("\n🛑 Captura cancelada por el usuario")
                    return
        
        # Definir ruta de salida con directorio específico
        if output_json is None:
            import os
            # Usar la ruta del directorio actual del script
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_json = os.path.join(script_dir, f"eeg_data_{int(duration)}s.json")
        
        print(f"📊 Iniciando captura de {duration} segundos para JSON...")
        print(f"💡 Los datos se guardarán automáticamente tras {duration} segundos")
        print(f"📁 Archivo de salida: {output_json}")
        print("⚠️  Presiona Ctrl+C para cancelar la captura\n")
        
        # Resetear datos para la nueva captura
        self.eeg_data = {i: [] for i in range(4)}
        self.timestamps = []
        self.sample_count = 0
        self.running = True
        
        try:
            # Probar conectividad de red primero
            if not self.test_network_connectivity():
                return
                
            # Configurar servidor OSC
            self.setup_osc_server()
            
            # Iniciar servidor OSC
            self.start_osc_server()
            
            print("✅ Sistema configurado - esperando datos OSC...")
            print("   Configura la app del Muse para enviar a 127.0.0.1:5000")
            print("   Captura iniciará automáticamente al recibir datos\n")
            
            # Tiempo de captura personalizable
            start_time = time.time()
            
            print(f"⏱️  Capturando durante {duration} segundos...")
            
            while time.time() - start_time < duration and self.running:
                try:
                    remaining = duration - (time.time() - start_time)
                    if remaining > 0:
                        print(f"\r⏱️  Tiempo restante: {remaining:.1f}s | Muestras: {self.sample_count}", end="", flush=True)
                        time.sleep(0.1)
                except KeyboardInterrupt:
                    print("\n🛑 Captura cancelada por el usuario")
                    return
            
            print(f"\n✅ Captura completada - {self.sample_count} muestras obtenidas")
            
            # Preparar datos para JSON
            capture_data = {
                "metadata": {
                    "duration_seconds": duration,
                    "total_samples": self.sample_count,
                    "sample_rate_hz": self.sample_count / duration if duration > 0 else 0,
                    "channels": 4,
                    "capture_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "start_time": start_time,
                    "end_time": time.time()
                },
                "eeg_channels": {
                    f"channel_{i+1}": self.eeg_data[i] for i in range(4)
                },
                "timestamps": self.timestamps,
                "statistics": {}
            }
            
            # Calcular estadísticas por canal
            for ch in range(4):
                if self.eeg_data[ch]:
                    data = np.array(self.eeg_data[ch])
                    capture_data["statistics"][f"channel_{ch+1}"] = {
                        "min": float(data.min()),
                        "max": float(data.max()),
                        "mean": float(data.mean()),
                        "std": float(data.std()),
                        "samples_count": len(data)
                    }
            
            # Guardar en archivo JSON con fallback robusto
            try:
                target_path = Path(output_json) if output_json else None
                filename = target_path.name if target_path else f"eeg_data_{int(duration)}s.json"
                saved_path = write_json_with_fallback(
                    capture_data,
                    target_file=target_path,
                    filename=filename,
                    extra_dirs=[Path(__file__).resolve().parent],
                    indent=2,
                )
                print(f"💾 Datos guardados exitosamente en: {saved_path}")
            except Exception as e:
                print(f"❌ Error crítico guardando datos JSON: {e}")
                return
            print(f"📊 Estadísticas de la captura:")
            print(f"   • Duración: {duration:.1f} segundos")
            print(f"   • Total muestras: {self.sample_count}")
            print(f"   • Frecuencia promedio: {capture_data['metadata']['sample_rate_hz']:.1f} Hz")
            
            for ch in range(4):
                if f"channel_{ch+1}" in capture_data["statistics"]:
                    stats = capture_data["statistics"][f"channel_{ch+1}"]
                    print(f"   • Canal {ch+1}: min={stats['min']:.3f}, max={stats['max']:.3f}, avg={stats['mean']:.3f}")
                        
        except Exception as e:
            print(f"❌ Error durante captura: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.stop_capture()
    
    def eeg_to_midi(self, output_midi=None):
        """Convierte datos EEG capturados a archivo MIDI"""
        if self.sample_count == 0:
            print("❌ No hay datos EEG para convertir")
            return
        
        if output_midi is None:
            import os
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_midi = os.path.join(script_dir, "eeg_output.mid")
        
        print(f"\n🎵 Generando archivo MIDI: {output_midi}")
        
        # Crear archivo MIDI con 4 pistas (una por canal EEG)
        mid = MIDIFile(4, file_format=1)
        
        # Configurar cada pista - instrumentos simples para no alterar el sonido
        instruments = [1, 1, 1, 1]  # Todos piano para sonido puro
        track_names = ["EEG Canal 1", "EEG Canal 2", "EEG Canal 3", "EEG Canal 4"]
        
        for track in range(4):
            mid.addTrackName(track, 0, track_names[track])
            mid.addTempo(track, 0, 120)  # 120 BPM
            mid.addProgramChange(track, track, 0, instruments[track])
        
        # Calcular duración real basada en timestamps
        if len(self.timestamps) > 1:
            total_duration = self.timestamps[-1] - self.timestamps[0]
        else:
            total_duration = 10.0  # fallback
        
        # Procesar TODOS los datos EEG - una nota por muestra
        min_samples = min(len(self.eeg_data[ch]) for ch in range(4) if len(self.eeg_data[ch]) > 0)
        
        if min_samples == 0:
            print("❌ No hay suficientes datos EEG para procesar")
            return
        
        # Duración por nota basada en la duración real y número de muestras
        note_duration = total_duration / min_samples if min_samples > 0 else 0.1
        
        print(f"📊 Procesando {min_samples} muestras...")
        print(f"⏱️  Duración real de captura: {total_duration:.2f} segundos")
        print(f"🎼 Duración por nota: {note_duration:.4f} segundos")
        
        for sample_idx in range(min_samples):
            # Tiempo real basado en la posición en la secuencia
            time_in_beats = (sample_idx / min_samples) * (total_duration / 0.5)  # 0.5 segundos por beat a 120 BPM
            
            for channel in range(4):
                if sample_idx < len(self.eeg_data[channel]):
                    eeg_val = self.eeg_data[channel][sample_idx]
                    
                    # Skip valores NaN o cero
                    if np.isnan(eeg_val) or eeg_val == 0:
                        continue
                    
                    midi_note = self.map_eeg_to_midi_note(eeg_val, channel)
                    velocity = self.calculate_note_velocity(eeg_val)
                    
                    # Agregar nota MIDI con duración calculada
                    mid.addNote(channel, channel, midi_note, time_in_beats, note_duration * 2, velocity)
        
        # Guardar archivo MIDI
        try:
            with open(output_midi, 'wb') as output_file:
                mid.writeFile(output_file)
            
            print(f"✅ Archivo MIDI generado exitosamente: {output_midi}")
            print(f"🎵 Duración del MIDI: {total_duration:.2f} segundos")
            print(f"🎹 {min_samples} notas por canal")
            print(f"📊 Conversión directa EEG → MIDI sin procesamiento musical")
            
            # Generar gráfica de ondas cerebrales
            import os
            base_name = os.path.splitext(output_midi)[0]
            output_image = f"{base_name}_waves.png"
            self.plot_eeg_waves(self.eeg_data, self.timestamps, output_image, 
                              f"Ondas Cerebrales EEG - {os.path.basename(output_midi)}")
            
        except Exception as e:
            print(f"❌ Error guardando archivo MIDI: {e}")
    
    def json_to_midi(self, json_file, output_midi=None):
        """Convierte datos EEG desde archivo JSON a archivo MIDI"""
        try:
            # Leer datos del JSON
            with open(json_file, 'r') as f:
                data = json.load(f)
            
            print(f"📖 Leyendo datos desde: {json_file}")
            
            # Extraer datos EEG
            eeg_channels = data.get('eeg_channels', {})
            metadata = data.get('metadata', {})
            
            # Use actual channel data length as source of truth — metadata.total_samples
            # may be 0 or missing in some captures.
            max_samples = max(len(eeg_channels.get(f"channel_{i}", [])) for i in range(1, 5))
            if max_samples == 0:
                raise ValueError("No hay datos EEG en el archivo JSON")
            
            duration_seconds = metadata.get('duration_seconds') or 10.0
            total_samples = metadata.get('total_samples') or max_samples
            
            print(f"📊 Datos encontrados: {total_samples} muestras, {duration_seconds:.1f}s")
            
            # Configurar archivo MIDI de salida
            if output_midi is None:
                import os
                script_dir = os.path.dirname(os.path.abspath(json_file))
                base_name = os.path.splitext(os.path.basename(json_file))[0]
                output_midi = os.path.join(script_dir, f"{base_name}.mid")
            
            print(f"🎵 Generando archivo MIDI: {output_midi}")
            
            # Crear archivo MIDI
            mid = MIDIFile(4, file_format=1)
            
            # Configurar pistas - instrumentos simples
            instruments = [1, 1, 1, 1]  # Todos piano para sonido puro
            track_names = ["EEG Canal 1", "EEG Canal 2", "EEG Canal 3", "EEG Canal 4"]
            
            for track in range(4):
                mid.addTrackName(track, 0, track_names[track])
                mid.addTempo(track, 0, 120)
                mid.addProgramChange(track, track, 0, instruments[track])
            
            note_duration = duration_seconds / max_samples
            
            print(f"⏱️  Duración real: {duration_seconds:.2f} segundos")
            print(f"🎼 Duración por nota: {note_duration:.4f} segundos")
            
            # Procesar cada canal
            for channel in range(1, 5):  # channels 1-4 en el JSON
                channel_key = f"channel_{channel}"
                if channel_key in eeg_channels:
                    channel_data = eeg_channels[channel_key]
                    track_idx = channel - 1
                    
                    print(f"🎼 Procesando canal {channel}: {len(channel_data)} muestras")
                    
                    # Procesar TODAS las muestras - una nota por muestra
                    for i, eeg_val in enumerate(channel_data):
                        # Skip valores inválidos
                        if eeg_val is None or np.isnan(eeg_val) or eeg_val == 0:
                            continue
                        
                        # Tiempo basado en posición real en la secuencia
                        time_in_beats = (i / len(channel_data)) * (duration_seconds / 0.5)  # 0.5 seg por beat
                        midi_note = self.map_eeg_to_midi_note(eeg_val, track_idx)
                        velocity = self.calculate_note_velocity(eeg_val)
                        
                        mid.addNote(track_idx, track_idx, midi_note, time_in_beats, note_duration * 2, velocity)
            
            # Guardar archivo
            with open(output_midi, 'wb') as output_file:
                mid.writeFile(output_file)
            
            print(f"✅ Conversión completada exitosamente!")
            print(f"🎵 Archivo MIDI: {output_midi}")
            print(f"⏱️  Duración del MIDI: {duration_seconds:.2f} segundos")
            print(f"📊 Conversión directa EEG → MIDI sin procesamiento musical")
            
            # Generar gráfica de ondas cerebrales desde JSON (solo si no es llamada de API)
            import os
            base_name = os.path.splitext(output_midi)[0]
            output_image = f"{base_name}_waves.png"
            
            # Convertir datos del JSON al formato esperado por plot_eeg_waves
            eeg_data_dict = {}
            for i in range(4):
                channel_key = f"channel_{i+1}"
                if channel_key in eeg_channels:
                    eeg_data_dict[i] = eeg_channels[channel_key]
                else:
                    eeg_data_dict[i] = []
            
            # Obtener timestamps si están disponibles
            timestamps_list = data.get('timestamps', [])
            if not timestamps_list and max_samples > 0:
                # Si no hay timestamps, crear una línea de tiempo sintética
                timestamps_list = [i * (duration_seconds / max_samples) for i in range(max_samples)]
            
            self.plot_eeg_waves(eeg_data_dict, timestamps_list, output_image,
                              f"Ondas Cerebrales EEG - {os.path.basename(json_file)}")
            
        except Exception as e:
            print(f"❌ Error procesando JSON a MIDI: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def run_with_midi_options(self):
        """Ejecuta el sistema con opciones de captura y conversión MIDI"""
        try:
            print("=" * 60)
            print("Muse 2 OSC Monitor - Opciones de Captura y MIDI")
            print("=" * 60)
            print("\n⚠️  CONFIGURACIÓN NECESARIA:")
            print("1. Abre la app del Muse en tu dispositivo móvil")
            print("2. Conecta tu Muse 2 por Bluetooth")
            print("3. En la app, configura el streaming OSC a:")
            print("   • IP: 127.0.0.1")
            print("   • Puerto: 5000")
            print("   • Incluir datos de EEG")
            print("4. Inicia el streaming OSC desde la app")
            
            print("\n🎵 OPCIONES DISPONIBLES:")
            print("1. Monitor en tiempo real (continuo hasta Ctrl+C)")
            print("2. Captura con duración personalizada (guarda en JSON)")
            print("3. Convertir JSON existente a MIDI")
            
            while True:
                try:
                    choice = input("\nSelecciona una opción (1, 2 o 3): ").strip()
                    if choice in ['1', '2', '3']:
                        break
                    else:
                        print("❌ Por favor ingresa 1, 2 o 3")
                except KeyboardInterrupt:
                    print("\n🛑 Programa cancelado por el usuario")
                    return
            
            if choice == '1':
                print("\n🚀 Iniciando monitor en tiempo real...\n")
                self.start_realtime_capture()
                
            elif choice == '2':
                print("\n⏱️  Iniciando captura con duración personalizada...\n")
                self.capture_custom_duration_to_json()
                
                # Preguntar si quiere convertir a MIDI automáticamente
                try:
                    convert = input("\n🎵 ¿Quieres convertir los datos capturados a MIDI ahora? (s/n): ").strip().lower()
                    if convert in ['s', 'si', 'y', 'yes']:
                        import os
                        script_dir = os.path.dirname(os.path.abspath(__file__))
                        # Buscar el archivo JSON más reciente con el patrón eeg_data_*s.json
                        json_files = [f for f in os.listdir(script_dir) if f.startswith("eeg_data_") and f.endswith("s.json")]
                        if json_files:
                            # Usar el archivo más reciente
                            json_files.sort(key=lambda x: os.path.getmtime(os.path.join(script_dir, x)), reverse=True)
                            json_file = os.path.join(script_dir, json_files[0])
                            print(f"\n🎼 Convirtiendo {json_files[0]} a MIDI...")
                            self.json_to_midi(json_file)
                        else:
                            print("❌ No se encontró el archivo JSON")
                except KeyboardInterrupt:
                    pass
                    
            elif choice == '3':
                try:
                    json_file = input("\n📁 Ingresa la ruta del archivo JSON (o presiona Enter para buscar automáticamente): ").strip()
                    if not json_file:
                        import os
                        script_dir = os.path.dirname(os.path.abspath(__file__))
                        # Buscar archivos JSON de EEG automáticamente
                        json_files = [f for f in os.listdir(script_dir) if f.startswith("eeg_data_") and f.endswith("s.json")]
                        if json_files:
                            # Mostrar opciones disponibles
                            print(f"\n📁 Archivos JSON encontrados:")
                            for i, f in enumerate(json_files, 1):
                                print(f"   {i}. {f}")
                            
                            try:
                                choice_idx = int(input(f"\nSelecciona un archivo (1-{len(json_files)}): ")) - 1
                                if 0 <= choice_idx < len(json_files):
                                    json_file = os.path.join(script_dir, json_files[choice_idx])
                                else:
                                    print("❌ Selección inválida")
                                    return
                            except ValueError:
                                print("❌ Por favor ingresa un número válido")
                                return
                        else:
                            print("❌ No se encontraron archivos JSON de EEG")
                            return
                    
                    import os
                    if not os.path.exists(json_file):
                        print(f"❌ No se encontró el archivo: {json_file}")
                        return
                    
                    print(f"\n🎼 Convirtiendo {json_file} a MIDI...")
                    self.json_to_midi(json_file)
                    
                except KeyboardInterrupt:
                    print("\n🛑 Conversión cancelada por el usuario")
                        
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.stop_capture()
    
    def run(self):
        """Ejecuta el sistema de captura - tiempo real o 10 segundos"""
        try:
            print("=" * 60)
            print("Muse 2 OSC Monitor - Opciones de Captura")
            print("=" * 60)
            print("\n⚠️  CONFIGURACIÓN NECESARIA:")
            print("1. Abre la app del Muse en tu dispositivo móvil")
            print("2. Conecta tu Muse 2 por Bluetooth")
            print("3. En la app, configura el streaming OSC a:")
            print("   • IP: 127.0.0.1")
            print("   • Puerto: 5000")
            print("   • Incluir datos de EEG")
            print("4. Inicia el streaming OSC desde la app")
            
            print("\n📊 OPCIONES DE CAPTURA:")
            print("1. Monitor en tiempo real (continuo hasta Ctrl+C)")
            print("2. Captura con duración personalizada (guarda en JSON)")
            
            while True:
                try:
                    choice = input("\nSelecciona una opción (1 o 2): ").strip()
                    if choice in ['1', '2']:
                        break
                    else:
                        print("❌ Por favor ingresa 1 o 2")
                except KeyboardInterrupt:
                    print("\n🛑 Programa cancelado por el usuario")
                    return
            
            if choice == '1':
                print("\n🚀 Iniciando monitor en tiempo real...\n")
                self.start_realtime_capture()
            elif choice == '2':
                print("\n⏱️  Iniciando captura con duración personalizada...\n")
                self.capture_custom_duration_to_json()
                        
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.stop_capture()


def main():
    try:
        converter = MuseOSCToMidi(output_file="muse_output.mid")
        converter.run_with_midi_options()  # Usar la nueva función con opciones MIDI
    except KeyboardInterrupt:
        print("\n🛑 Programa interrumpido por el usuario")
    finally:
        print("\n" + "=" * 60)
        print("Sesión terminada. ¡Gracias por usar Muse OSC Monitor!")
        input("Presiona Enter para cerrar...")


if __name__ == "__main__":
    main()

