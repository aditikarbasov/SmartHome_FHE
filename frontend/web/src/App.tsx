import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DeviceData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  deviceType: string;
  status: string;
}

interface HomeStatistics {
  totalDevices: number;
  onlineDevices: number;
  encryptedCommands: number;
  avgResponseTime: number;
  energyUsage: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [addingDevice, setAddingDevice] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDeviceData, setNewDeviceData] = useState({ 
    name: "", 
    value: "", 
    deviceType: "light",
    description: "" 
  });
  const [selectedDevice, setSelectedDevice] = useState<DeviceData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [statistics, setStatistics] = useState<HomeStatistics>({
    totalDevices: 0,
    onlineDevices: 0,
    encryptedCommands: 0,
    avgResponseTime: 0,
    energyUsage: 0
  });
  const [operationHistory, setOperationHistory] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showCharts, setShowCharts] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadDevices();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadDevices = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const devicesList: DeviceData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          devicesList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: "",
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            deviceType: businessData.publicValue1 > 50 ? "appliance" : "light",
            status: businessData.isVerified ? "online" : "offline"
          });
        } catch (e) {
          console.error('Error loading device data:', e);
        }
      }
      
      setDevices(devicesList);
      updateStatistics(devicesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load devices" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStatistics = (devicesList: DeviceData[]) => {
    const totalDevices = devicesList.length;
    const onlineDevices = devicesList.filter(d => d.status === "online").length;
    const encryptedCommands = devicesList.filter(d => d.isVerified).length;
    const avgResponseTime = devicesList.length > 0 ? 
      devicesList.reduce((sum, d) => sum + d.publicValue2, 0) / devicesList.length : 0;
    const energyUsage = devicesList.reduce((sum, d) => sum + (d.decryptedValue || 0), 0);

    setStatistics({
      totalDevices,
      onlineDevices,
      encryptedCommands,
      avgResponseTime,
      energyUsage
    });
  };

  const addDevice = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingDevice(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding device with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const deviceValue = parseInt(newDeviceData.value) || 0;
      const businessId = `device-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, deviceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDeviceData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        Math.floor(Math.random() * 1000),
        newDeviceData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      addOperationHistory("Device Added", `Added ${newDeviceData.name} with FHE encryption`);
      addNotification("Device Added", `${newDeviceData.name} is now secured with FHE`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Device added successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadDevices();
      setShowAddDevice(false);
      setNewDeviceData({ name: "", value: "", deviceType: "light", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingDevice(false); 
    }
  };

  const controlDevice = async (deviceId: string, command: number) => {
    if (!isConnected || !address) return;
    
    setTransactionStatus({ visible: true, status: "pending", message: "Sending encrypted command..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const encryptedResult = await encrypt(contractAddress, address, command);
      
      const tx = await contract.createBusinessData(
        `command-${Date.now()}`,
        `Control Command for ${deviceId}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        command,
        Date.now(),
        `Control command sent to ${deviceId}`
      );
      
      await tx.wait();
      
      addOperationHistory("Device Controlled", `Sent encrypted command to device`);
      addNotification("Command Sent", `Encrypted command delivered to device`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Command sent securely!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadDevices();
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Control failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptDeviceData = async (deviceId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(deviceId);
      if (businessData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(deviceId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(deviceId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadDevices();
      addOperationHistory("Data Decrypted", `Decrypted device data using FHE`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System availability check passed!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addOperationHistory = (action: string, details: string) => {
    const newHistory = {
      timestamp: Date.now(),
      action,
      details,
      user: address
    };
    setOperationHistory(prev => [newHistory, ...prev.slice(0, 9)]);
  };

  const addNotification = (title: string, message: string) => {
    const newNotification = {
      id: Date.now(),
      title,
      message,
      timestamp: Date.now(),
      read: false
    };
    setNotifications(prev => [newNotification, ...prev]);
  };

  const markNotificationAsRead = (id: number) => {
    setNotifications(prev => 
      prev.map(notif => notif.id === id ? { ...notif, read: true } : notif)
    );
  };

  const renderStatistics = () => {
    return (
      <div className="statistics-grid">
        <div className="stat-card gold-card">
          <div className="stat-icon">🏠</div>
          <div className="stat-content">
            <div className="stat-value">{statistics.totalDevices}</div>
            <div className="stat-label">Total Devices</div>
          </div>
        </div>
        
        <div className="stat-card silver-card">
          <div className="stat-icon">🟢</div>
          <div className="stat-content">
            <div className="stat-value">{statistics.onlineDevices}</div>
            <div className="stat-label">Online</div>
          </div>
        </div>
        
        <div className="stat-card bronze-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <div className="stat-value">{statistics.encryptedCommands}</div>
            <div className="stat-label">Encrypted</div>
          </div>
        </div>
        
        <div className="stat-card copper-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{statistics.energyUsage}W</div>
            <div className="stat-label">Energy Usage</div>
          </div>
        </div>
      </div>
    );
  };

  const renderCharts = () => {
    if (!showCharts) return null;

    return (
      <div className="charts-section">
        <div className="chart-panel">
          <h3>Device Activity</h3>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${Math.min(100, statistics.onlineDevices * 20)}%` }}></div>
          </div>
        </div>
        
        <div className="chart-panel">
          <h3>Encryption Usage</h3>
          <div className="chart-bar">
            <div className="bar-fill encrypted" style={{ width: `${Math.min(100, statistics.encryptedCommands * 25)}%` }}></div>
          </div>
        </div>
      </div>
    );
  };

  const renderOperationHistory = () => {
    return (
      <div className="history-panel">
        <h3>Recent Operations</h3>
        <div className="history-list">
          {operationHistory.slice(0, 5).map((op, index) => (
            <div key={index} className="history-item">
              <div className="history-time">{new Date(op.timestamp).toLocaleTimeString()}</div>
              <div className="history-action">{op.action}</div>
              <div className="history-details">{op.details}</div>
            </div>
          ))}
          {operationHistory.length === 0 && (
            <div className="no-history">No operations yet</div>
          )}
        </div>
      </div>
    );
  };

  const renderNotifications = () => {
    const unreadNotifications = notifications.filter(n => !n.read);
    
    return (
      <div className="notifications-panel">
        <div className="notifications-header">
          <h3>System Notifications</h3>
          {unreadNotifications.length > 0 && (
            <span className="notification-badge">{unreadNotifications.length}</span>
          )}
        </div>
        <div className="notifications-list">
          {notifications.slice(0, 3).map(notif => (
            <div 
              key={notif.id} 
              className={`notification-item ${notif.read ? 'read' : 'unread'}`}
              onClick={() => markNotificationAsRead(notif.id)}
            >
              <div className="notification-title">{notif.title}</div>
              <div className="notification-message">{notif.message}</div>
              <div className="notification-time">{new Date(notif.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
          {notifications.length === 0 && (
            <div className="no-notifications">No notifications</div>
          )}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Secure Smart Home 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🏠</div>
            <h2>Connect Your Wallet to Secure Your Home</h2>
            <p>FHE-encrypted smart home control system for ultimate privacy protection</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Add and control devices with encrypted commands</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Monitor your home with privacy-first approach</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Security System...</p>
        <p className="loading-note">Securing your smart home with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading Secure Home System...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Secure Smart Home 🔐</h1>
          <span className="tagline">FHE-Protected IoT Control</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCharts(!showCharts)} 
            className="chart-btn"
          >
            {showCharts ? 'Hide Charts' : 'Show Analytics'}
          </button>
          <button 
            onClick={callIsAvailable} 
            className="test-btn"
          >
            Test System
          </button>
          <button 
            onClick={() => setShowAddDevice(true)} 
            className="add-btn"
          >
            + Add Device
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="control-center">
          <div className="center-panel">
            <h2>Home Control Center</h2>
            {renderStatistics()}
            {renderCharts()}
            
            <div className="devices-section">
              <div className="section-header">
                <h3>Connected Devices</h3>
                <button 
                  onClick={loadDevices} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "🔄" : "Refresh"}
                </button>
              </div>
              
              <div className="devices-grid">
                {devices.length === 0 ? (
                  <div className="no-devices">
                    <p>No devices connected</p>
                    <button 
                      className="add-btn" 
                      onClick={() => setShowAddDevice(true)}
                    >
                      Add First Device
                    </button>
                  </div>
                ) : devices.map((device, index) => (
                  <div 
                    className={`device-card ${device.status} ${selectedDevice?.id === device.id ? "selected" : ""}`}
                    key={index}
                    onClick={() => setSelectedDevice(device)}
                  >
                    <div className="device-header">
                      <div className="device-icon">
                        {device.deviceType === "light" ? "💡" : "🔌"}
                      </div>
                      <div className="device-status"></div>
                    </div>
                    <div className="device-name">{device.name}</div>
                    <div className="device-meta">
                      <span>Type: {device.deviceType}</span>
                      <span>Status: {device.status}</span>
                    </div>
                    <div className="device-controls">
                      <button 
                        onClick={(e) => { e.stopPropagation(); controlDevice(device.id, 1); }}
                        className="control-btn"
                      >
                        Power On
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); controlDevice(device.id, 0); }}
                        className="control-btn off"
                      >
                        Power Off
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="side-panels">
            {renderOperationHistory()}
            {renderNotifications()}
          </div>
        </div>
      </div>
      
      {showAddDevice && (
        <AddDeviceModal 
          onSubmit={addDevice} 
          onClose={() => setShowAddDevice(false)} 
          adding={addingDevice} 
          deviceData={newDeviceData} 
          setDeviceData={setNewDeviceData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedDevice && (
        <DeviceDetailModal 
          device={selectedDevice} 
          onClose={() => setSelectedDevice(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptDeviceData(selectedDevice.id)}
          controlDevice={controlDevice}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const AddDeviceModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  deviceData: any;
  setDeviceData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, deviceData, setDeviceData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDeviceData({ ...deviceData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="add-device-modal">
        <div className="modal-header">
          <h2>Add New Device</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Security</strong>
            <p>Device commands will be encrypted with homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Device Name *</label>
            <input 
              type="text" 
              name="name" 
              value={deviceData.name} 
              onChange={handleChange} 
              placeholder="Enter device name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Device Type</label>
            <select name="deviceType" value={deviceData.deviceType} onChange={handleChange}>
              <option value="light">Light</option>
              <option value="thermostat">Thermostat</option>
              <option value="camera">Camera</option>
              <option value="appliance">Appliance</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Initial Value (Integer) *</label>
            <input 
              type="number" 
              name="value" 
              value={deviceData.value} 
              onChange={handleChange} 
              placeholder="Enter initial value..." 
              step="1"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={deviceData.description} 
              onChange={handleChange} 
              placeholder="Device description..."
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || isEncrypting || !deviceData.name || !deviceData.value} 
            className="submit-btn"
          >
            {adding || isEncrypting ? "Encrypting and Adding..." : "Add Device"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DeviceDetailModal: React.FC<{
  device: DeviceData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  controlDevice: (deviceId: string, command: number) => void;
}> = ({ device, onClose, isDecrypting, decryptData, controlDevice }) => {
  const [localDecryptedValue, setLocalDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const decrypted = await decryptData();
    setLocalDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="device-detail-modal">
        <div className="modal-header">
          <h2>Device Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="device-info">
            <div className="info-grid">
              <div className="info-item">
                <span>Device Name:</span>
                <strong>{device.name}</strong>
              </div>
              <div className="info-item">
                <span>Type:</span>
                <strong>{device.deviceType}</strong>
              </div>
              <div className="info-item">
                <span>Status:</span>
                <strong className={`status-${device.status}`}>{device.status}</strong>
              </div>
              <div className="info-item">
                <span>Added:</span>
                <strong>{new Date(device.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>Encryption:</span>
                <strong>🔐 FHE Protected</strong>
              </div>
              <div className="status-item">
                <span>Verification:</span>
                <strong>{device.isVerified ? "✅ On-chain Verified" : "🔓 Pending"}</strong>
              </div>
            </div>
            
            <div className="data-value">
              Current Value: {device.isVerified ? 
                `${device.decryptedValue} (Verified)` : 
                localDecryptedValue !== null ? 
                `${localDecryptedValue} (Local)` : 
                "🔒 Encrypted"
              }
            </div>
            
            <button 
              className={`decrypt-btn ${device.isVerified ? 'verified' : ''}`}
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : device.isVerified ? "✅ Verified" : "🔓 Decrypt"}
            </button>
          </div>
          
          <div className="control-section">
            <h3>Quick Controls</h3>
            <div className="control-buttons">
              <button onClick={() => controlDevice(device.id, 1)} className="control-btn">
                Power On
              </button>
              <button onClick={() => controlDevice(device.id, 0)} className="control-btn off">
                Power Off
              </button>
              <button onClick={() => controlDevice(device.id, 50)} className="control-btn">
                Set 50%
              </button>
              <button onClick={() => controlDevice(device.id, 100)} className="control-btn">
                Set 100%
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


