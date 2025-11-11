pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SmartHomeControl is ZamaEthereumConfig {
    
    struct Device {
        string deviceId;                    
        euint32 encryptedCommand;        
        uint256 lastUpdated;          
        string deviceType;          
        address owner;               
        bool isActive;             
        uint32 decryptedCommand; 
        bool isVerified; 
    }
    
    mapping(string => Device) public devices;
    string[] public deviceIds;
    
    event DeviceRegistered(string indexed deviceId, address indexed owner);
    event CommandVerified(string indexed deviceId, uint32 decryptedCommand);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function registerDevice(
        string calldata deviceId,
        string calldata deviceType,
        externalEuint32 encryptedCommand,
        bytes calldata inputProof
    ) external {
        require(bytes(devices[deviceId].deviceId).length == 0, "Device already registered");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedCommand, inputProof)), "Invalid encrypted input");
        
        devices[deviceId] = Device({
            deviceId: deviceId,
            encryptedCommand: FHE.fromExternal(encryptedCommand, inputProof),
            lastUpdated: block.timestamp,
            deviceType: deviceType,
            owner: msg.sender,
            isActive: true,
            decryptedCommand: 0,
            isVerified: false
        });
        
        FHE.allowThis(devices[deviceId].encryptedCommand);
        FHE.makePubliclyDecryptable(devices[deviceId].encryptedCommand);
        
        deviceIds.push(deviceId);
        emit DeviceRegistered(deviceId, msg.sender);
    }
    
    function verifyCommand(
        string calldata deviceId, 
        bytes memory abiEncodedClearCommand,
        bytes memory decryptionProof
    ) external {
        require(bytes(devices[deviceId].deviceId).length > 0, "Device does not exist");
        require(!devices[deviceId].isVerified, "Command already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(devices[deviceId].encryptedCommand);
        
        FHE.checkSignatures(cts, abiEncodedClearCommand, decryptionProof);
        
        uint32 decodedCommand = abi.decode(abiEncodedClearCommand, (uint32));
        
        devices[deviceId].decryptedCommand = decodedCommand;
        devices[deviceId].isVerified = true;
        devices[deviceId].lastUpdated = block.timestamp;
        
        emit CommandVerified(deviceId, decodedCommand);
    }
    
    function getEncryptedCommand(string calldata deviceId) external view returns (euint32) {
        require(bytes(devices[deviceId].deviceId).length > 0, "Device does not exist");
        return devices[deviceId].encryptedCommand;
    }
    
    function getDeviceDetails(string calldata deviceId) external view returns (
        string memory deviceType,
        address owner,
        uint256 lastUpdated,
        bool isActive,
        bool isVerified,
        uint32 decryptedCommand
    ) {
        require(bytes(devices[deviceId].deviceId).length > 0, "Device does not exist");
        Device storage device = devices[deviceId];
        
        return (
            device.deviceType,
            device.owner,
            device.lastUpdated,
            device.isActive,
            device.isVerified,
            device.decryptedCommand
        );
    }
    
    function getAllDeviceIds() external view returns (string[] memory) {
        return deviceIds;
    }
    
    function updateDeviceStatus(string calldata deviceId, bool status) external {
        require(bytes(devices[deviceId].deviceId).length > 0, "Device does not exist");
        require(devices[deviceId].owner == msg.sender, "Only owner can update status");
        
        devices[deviceId].isActive = status;
        devices[deviceId].lastUpdated = block.timestamp;
    }
    
    function isDeviceActive(string calldata deviceId) external view returns (bool) {
        require(bytes(devices[deviceId].deviceId).length > 0, "Device does not exist");
        return devices[deviceId].isActive;
    }
}


